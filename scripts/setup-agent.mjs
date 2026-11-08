// Creates the 6 cuida client tools and the cuida agent in your ElevenLabs workspace.
// Usage: ELEVENLABS_API_KEY=sk_... node scripts/setup-agent.mjs
// Optional: ELEVENLABS_VOICE_ID=... AGENT_LLM=gemini-2.5-flash
import { readFileSync, existsSync, writeFileSync } from "node:fs";

// Load .env.local if present (no dependency on dotenv)
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("Set ELEVENLABS_API_KEY in .env.local or your shell first.");
  process.exit(1);
}
const API = "https://api.elevenlabs.io/v1/convai";
const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };

async function call(path, body) {
  const res = await fetch(API + path, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return JSON.parse(text);
}

const tools = JSON.parse(readFileSync("agent/tools.json", "utf8"));
const prompt = readFileSync("agent/system-prompt.md", "utf8");

const toolIds = [];
for (const t of tools) {
  const created = await call("/tools", { tool_config: t });
  console.log(`tool  ${t.name.padEnd(24)} ${created.id}`);
  toolIds.push(created.id);
}

const agentPrompt = { prompt, tool_ids: toolIds };
if (process.env.AGENT_LLM) agentPrompt.llm = process.env.AGENT_LLM;

const conversation_config = {
  agent: {
    first_message: "Hi Rosa, it's cuida. What would you like to know about your health today?",
    language: "en",
    prompt: agentPrompt,
  },
};
if (process.env.ELEVENLABS_VOICE_ID) conversation_config.tts = { voice_id: process.env.ELEVENLABS_VOICE_ID };

const agent = await call("/agents/create", { name: "cuida", conversation_config });
console.log(`\nagent cuida ${agent.agent_id}`);

// Write the agent id into .env.local
let env = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
env = env.replace(/^NEXT_PUBLIC_ELEVENLABS_AGENT_ID=.*$/m, "").trimEnd();
env += `\nNEXT_PUBLIC_ELEVENLABS_AGENT_ID=${agent.agent_id}\n`;
writeFileSync(".env.local", env.trimStart());
console.log("Saved NEXT_PUBLIC_ELEVENLABS_AGENT_ID to .env.local");
console.log("\nNext: in the ElevenLabs dashboard, open the agent > Agent tab > add Spanish as an additional language, then `npm run dev`.");
