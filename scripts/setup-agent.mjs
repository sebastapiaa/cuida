// Creates or updates (syncs) the cuida agent and its 11 webhook tools in your ElevenLabs workspace.
// Run it again any time the public URL, the prompt, or the tools change. Safe to re-run.
//
//   PUBLIC_URL=https://xxxx.trycloudflare.com npm run sync:agent
//   npm run agent:show        (print the live agent config, no changes)
//
// Reads ELEVENLABS_API_KEY (+ optional ELEVENLABS_VOICE_ID, AGENT_LLM, CUIDA_AGENT_KEY) from .env.local.
// Every sync enforces the fast-voice settings: flash TTS (eleven_flash_v2_5, or eleven_flash_v2 which is
// what the API requires for an English-primary agent; no expressive tags), fastest LLM the API accepts,
// eager turn taking, webhook tools with no pre-tool filler speech.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { httpGet } from "./lib/net.mjs";

const ENV = ".env.local";
const STATE = "agent/.agent-state.json";
const SHOW_ONLY = process.argv.includes("--show");

const envText = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
for (const line of envText.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
function saveEnv(key, value) {
  let t = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const re = new RegExp(`^${key}=.*$`, "m");
  t = re.test(t) ? t.replace(re, `${key}=${value}`) : `${t.trimEnd()}\n${key}=${value}\n`;
  writeFileSync(ENV, t.trimStart());
}
function exit(msg) {
  console.error(msg);
  process.exit(1);
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) exit("Set ELEVENLABS_API_KEY in .env.local");
const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io/v1/convai";

class ApiError extends Error {
  constructor(method, path, status, text) {
    super(`${method} ${path} -> ${status}: ${text}`);
    this.status = status;
    this.text = text;
  }
}
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { "xi-api-key": KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new ApiError(method, path, res.status, text);
  return text ? JSON.parse(text) : {};
}

/* ------------------------------------------------------------------ */
/* Show the live agent                                                 */
/* ------------------------------------------------------------------ */
function describe(a) {
  const c = a.conversation_config || {};
  const p = c.agent?.prompt || {};
  console.log(`agent      ${a.name} (${a.agent_id})`);
  console.log(`llm        ${p.llm}   temperature ${p.temperature}   max_tokens ${p.max_tokens}   thinking_budget ${p.thinking_budget ?? "default"}`);
  console.log(`tts speed  streaming_latency ${c.tts?.optimize_streaming_latency}`);
  console.log(`tts        ${c.tts?.model_id}   voice ${c.tts?.voice_id}   expressive ${c.tts?.expressive_mode ?? "n/a"}`);
  console.log(`turn       eagerness ${c.turn?.turn_eagerness}   timeout ${c.turn?.turn_timeout}s`);
  console.log(`language   ${c.agent?.language}   presets ${JSON.stringify(Object.keys(c.language_presets || {}))}`);
  console.log(`knowledge  ${JSON.stringify(p.knowledge_base || [])}`);
  const builtins = Object.entries(p.built_in_tools || {}).filter(([, v]) => v).map(([k]) => k);
  console.log(`system     ${JSON.stringify(builtins)}`);
  console.log(`tool_ids   ${(p.tool_ids || []).length}`);
  for (const t of p.tools || []) if (t.type === "webhook") console.log(`  ${t.name.padEnd(26)} ${t.api_schema?.method?.padEnd(5) || ""} ${t.api_schema?.url}   timeout ${t.response_timeout_secs}s`);
  console.log(`first      ${c.agent?.first_message}`);
}

const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
let current = null;
if (agentId) {
  try {
    current = await call("GET", `/agents/${agentId}`);
  } catch (e) {
    console.log(`could not read agent ${agentId}: ${e.message.slice(0, 120)}`);
  }
}
if (SHOW_ONLY) {
  if (!current) exit("No agent to show. Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local");
  describe(current);
  const live = await call("GET", "/tools");
  console.log(`\nworkspace tools: ${live.tools.length}`);
  for (const t of live.tools) console.log(`  ${t.tool_config.name.padEnd(26)} ${t.id}  ${t.tool_config.api_schema?.url || ""}`);
  process.exit(0);
}

const BASE = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
if (!/^https:\/\//.test(BASE)) exit("Set PUBLIC_URL to your public https URL (run `npm run up`, or `npm run tunnel` and copy the trycloudflare.com URL)");

let AGENT_KEY = process.env.CUIDA_AGENT_KEY;
if (!AGENT_KEY) {
  AGENT_KEY = randomBytes(18).toString("hex");
  saveEnv("CUIDA_AGENT_KEY", AGENT_KEY);
  console.log("Generated CUIDA_AGENT_KEY (saved to .env.local). Restart the server so it picks it up.");
}
saveEnv("PUBLIC_URL", BASE);

/* ------------------------------------------------------------------ */
/* 1. Tools: update in place (by saved id, else by name), else create  */
/* ------------------------------------------------------------------ */
const tools = JSON.parse(readFileSync("agent/tools.json", "utf8").replaceAll("{{BASE_URL}}", BASE).replaceAll("{{AGENT_KEY}}", AGENT_KEY));
const prompt = readFileSync("agent/system-prompt.md", "utf8");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { tools: {} };
state.tools ||= {};

const live = await call("GET", "/tools");
const liveByName = new Map(live.tools.map((t) => [t.tool_config.name, t.id]));
const liveIds = new Set(live.tools.map((t) => t.id));

// Voice settings applied to every webhook tool. Fields the API rejects are dropped automatically.
const FAST_TOOL = { pre_tool_speech: "off", execution_mode: "immediate", disable_interruptions: false };
const TOOL_FALLBACKS = ["execution_mode", "pre_tool_speech", "disable_interruptions"];
let dropped = new Set();

async function upsertTool(t) {
  const cfg = { ...t, ...FAST_TOOL };
  for (const f of dropped) delete cfg[f];
  const attempt = async () => {
    let id = state.tools[t.name];
    if (id && !liveIds.has(id)) id = undefined;
    id ||= liveByName.get(t.name);
    if (id) {
      await call("PATCH", `/tools/${id}`, { tool_config: cfg });
      console.log(`updated tool  ${t.name.padEnd(26)} ${id}`);
      return id;
    }
    const created = await call("POST", "/tools", { tool_config: cfg });
    console.log(`created tool  ${t.name.padEnd(26)} ${created.id}`);
    return created.id;
  };
  for (;;) {
    try {
      return await attempt();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 422) throw e;
      const f = TOOL_FALLBACKS.find((k) => k in cfg && e.text.includes(k));
      if (!f) throw e;
      console.log(`  API rejected tool field "${f}", dropping it (${e.text.slice(0, 100)})`);
      dropped.add(f);
      delete cfg[f];
    }
  }
}
for (const t of tools) state.tools[t.name] = await upsertTool(t);
writeFileSync(STATE, JSON.stringify(state, null, 2));
const toolIds = tools.map((t) => state.tools[t.name]);

/* ------------------------------------------------------------------ */
/* 2. Agent                                                            */
/* ------------------------------------------------------------------ */
const cur = current?.conversation_config || {};
const curPrompt = cur.agent?.prompt || {};
// Fastest first. Measured on this agent: gemini-2.5-flash took 2.5-3.5s per generation (thinking on).
const LLM_CANDIDATES = [...new Set([process.env.AGENT_LLM, "gemini-2.5-flash-lite", "gemini-2.0-flash", "gpt-4.1-nano", "gpt-4.1-mini", "gemini-2.5-flash", curPrompt.llm].filter(Boolean))];

// Keep only the system tools we want (end_call, language_detection); drop the rest.
const builtIn = {};
for (const name of ["end_call", "language_detection"]) {
  builtIn[name] = curPrompt.built_in_tools?.[name] || { type: "system", name, description: "", params: { system_tool_type: name } };
}

// Spanish preset so language_detection can switch; keep any presets already on the agent.
const presets = { ...(cur.language_presets || {}) };
if (!presets.es) presets.es = { overrides: { agent: { language: "es" } } };

const voiceId = process.env.ELEVENLABS_VOICE_ID || cur.tts?.voice_id;
const TTS_CANDIDATES = ["eleven_flash_v2_5", "eleven_flash_v2"];
function buildConfig(llm, ttsModel, opts = {}) {
  const tts = { ...(cur.tts || {}), model_id: ttsModel, optimize_streaming_latency: 4 };
  if (voiceId) tts.voice_id = voiceId;
  if (!opts.keepExpressive) {
    tts.expressive_mode = false;
    tts.suggested_audio_tags = [];
  }
  // These are read-only / derived in the GET payload; never send them back
  delete tts.supported_voices;
  delete tts.pronunciation_dictionary_locators;
  delete tts.audio_effects;
  delete tts.clone_strength;
  const turn = { ...(cur.turn || {}) };
  if (!opts.noEager) turn.turn_eagerness = "eager";
  const conversation_config = {
    agent: {
      first_message: "Hi Rosa, it's cuida. How are you feeling today?",
      language: "en",
      prompt: { prompt, llm, temperature: 0, max_tokens: 160, tool_ids: toolIds, built_in_tools: builtIn, ...(opts.noThinking ? {} : { thinking_budget: 0, reasoning_effort: null }) },
    },
    tts,
    turn,
  };
  if (!opts.noPresets) conversation_config.language_presets = presets;
  return conversation_config;
}

// Try the fastest settings first; on a 422 read the message and relax one thing at a time.
const plans = [];
const relax = [{}, { noThinking: true }, { keepExpressive: true, noThinking: true }, { noEager: true, noThinking: true }, { noPresets: true, noThinking: true }, { keepExpressive: true, noEager: true, noPresets: true, noThinking: true }];
for (const o of relax) for (const tts of TTS_CANDIDATES) for (const llm of LLM_CANDIDATES) plans.push({ llm, tts, opts: o });

let result = null;
const tried = new Set();
for (const plan of plans) {
  // skip combinations whose exact rejection reason we have already seen
  const conversation_config = buildConfig(plan.llm, plan.tts, plan.opts);
  const label = `tts=${plan.tts} llm=${plan.llm}${Object.keys(plan.opts).length ? " relaxed=" + Object.keys(plan.opts).join(",") : ""}`;
  try {
    if (current) {
      result = await call("PATCH", `/agents/${agentId}`, { name: "cuida", conversation_config });
      console.log(`\nupdated agent cuida ${agentId}  ${label}`);
    } else {
      result = await call("POST", "/agents/create", { name: "cuida", conversation_config });
      console.log(`\ncreated agent cuida ${result.agent_id}  ${label}`);
    }
    break;
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 422 && e.status !== 400)) throw e;
    const msg = (JSON.parse(e.text)?.detail?.message || e.text).slice(0, 200);
    if (!tried.has(msg)) console.log(`  rejected (${label}): ${msg}`);
    tried.add(msg);
  }
}
if (!result) exit("Every agent payload was rejected. See the messages above.");
state.agent_id = result.agent_id || agentId;
writeFileSync(STATE, JSON.stringify(state, null, 2));
saveEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID", state.agent_id);

/* ------------------------------------------------------------------ */
/* 3. Verify + smoke test                                              */
/* ------------------------------------------------------------------ */
const after = await call("GET", `/agents/${state.agent_id}`);
console.log("");
describe(after);
const gotIds = after.conversation_config?.agent?.prompt?.tool_ids || [];
const missing = toolIds.filter((id) => !gotIds.includes(id));
const extra = gotIds.filter((id) => !toolIds.includes(id));
if (missing.length || extra.length) console.log(`\n! tool_ids mismatch: missing ${missing.length}, extra ${extra.length}`);
else console.log(`\n✓ agent has exactly the ${toolIds.length} cuida tools`);

const probe = await httpGet(`${BASE}/api/agent/briefing`, { headers: { "x-cuida-key": AGENT_KEY }, timeout: 15000 });
console.log(probe.status === 200 ? `✓ ${BASE}/api/agent/briefing reachable (200, ${probe.ms}ms)` : `✗ ${BASE}/api/agent/briefing not reachable (${probe.status || probe.error}). Is the server + tunnel running?`);
console.log(`\nTest it now: https://elevenlabs.io/app/agents/agents/${state.agent_id}  (click "Test AI agent")`);
