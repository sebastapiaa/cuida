// Creates or updates (syncs) the cuida agent and its 11 webhook tools in your ElevenLabs workspace.
// Run it again any time the public URL, the prompt, or the tools change. Safe to re-run.
//
//   PUBLIC_URL=https://xxxx.trycloudflare.com npm run sync:agent
//
// Reads ELEVENLABS_API_KEY (+ optional ELEVENLABS_VOICE_ID, AGENT_LLM, CUIDA_AGENT_KEY) from .env.local.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const ENV = ".env.local";
const STATE = "agent/.agent-state.json";

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

const KEY = process.env.ELEVENLABS_API_KEY;
const BASE = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
if (!KEY) exit("Set ELEVENLABS_API_KEY in .env.local");
if (!/^https:\/\//.test(BASE)) exit("Set PUBLIC_URL to your public https URL (run `npm run tunnel` and copy the trycloudflare.com URL)");

let AGENT_KEY = process.env.CUIDA_AGENT_KEY;
if (!AGENT_KEY) {
  AGENT_KEY = randomBytes(18).toString("hex");
  saveEnv("CUIDA_AGENT_KEY", AGENT_KEY);
  console.log("Generated CUIDA_AGENT_KEY (saved to .env.local). Restart `npm run dev` so the server picks it up.");
}
saveEnv("PUBLIC_URL", BASE);

const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io/v1/convai";
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { "xi-api-key": KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
function exit(msg) {
  console.error(msg);
  process.exit(1);
}

// Fill {{BASE_URL}} and {{AGENT_KEY}} in the tool templates
const tools = JSON.parse(readFileSync("agent/tools.json", "utf8").replaceAll("{{BASE_URL}}", BASE).replaceAll("{{AGENT_KEY}}", AGENT_KEY));
const prompt = readFileSync("agent/system-prompt.md", "utf8");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { tools: {} };

// 1. Tools: update if we created it before, otherwise create
for (const t of tools) {
  const id = state.tools[t.name];
  if (id) {
    try {
      await call("PATCH", `/tools/${id}`, { tool_config: t });
      console.log(`updated tool  ${t.name.padEnd(26)} ${id}`);
      continue;
    } catch (e) {
      console.log(`could not update ${t.name}, recreating (${e.message.slice(0, 80)})`);
    }
  }
  const created = await call("POST", "/tools", { tool_config: t });
  state.tools[t.name] = created.id;
  console.log(`created tool  ${t.name.padEnd(26)} ${created.id}`);
}
writeFileSync(STATE, JSON.stringify(state, null, 2));

// 2. Agent
const agentPrompt = { prompt, tool_ids: tools.map((t) => state.tools[t.name]) };
if (process.env.AGENT_LLM) agentPrompt.llm = process.env.AGENT_LLM;
const conversation_config = {
  agent: {
    first_message: "Hi Rosa, it's cuida. How are you feeling today?",
    language: "en",
    prompt: agentPrompt,
  },
};
if (process.env.ELEVENLABS_VOICE_ID) conversation_config.tts = { voice_id: process.env.ELEVENLABS_VOICE_ID };

const agentId = state.agent_id || process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
if (agentId) {
  await call("PATCH", `/agents/${agentId}`, { name: "cuida", conversation_config });
  console.log(`\nupdated agent cuida ${agentId}`);
  state.agent_id = agentId;
} else {
  const agent = await call("POST", "/agents/create", { name: "cuida", conversation_config });
  state.agent_id = agent.agent_id;
  console.log(`\ncreated agent cuida ${agent.agent_id}`);
}
writeFileSync(STATE, JSON.stringify(state, null, 2));
saveEnv("NEXT_PUBLIC_ELEVENLABS_AGENT_ID", state.agent_id);

// 3. Smoke test: the agent's endpoint is reachable through the public URL with the key
const probe = await fetch(`${BASE}/api/agent/briefing`, { headers: { "x-cuida-key": AGENT_KEY } }).catch((e) => ({ ok: false, status: String(e) }));
console.log(probe.ok ? `\n✓ ${BASE}/api/agent/briefing reachable` : `\n✗ ${BASE}/api/agent/briefing not reachable (${probe.status}). Is \`npm run dev\` + \`npm run tunnel\` running, and did you restart dev after the key was generated?`);
console.log(`\nTest it now: https://elevenlabs.io/app/agents/agents/${state.agent_id}  (click "Test AI agent")`);
