// Persistence for the platform's mutable state (doses, readings, questions, refills, feed).
//
// Local `next start`: state lives in server memory (globalThis), nothing to configure.
// Vercel: each serverless instance has its own memory, so the agent's writes and the demo
// screen could land on different instances. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// (Vercel Marketplace -> Upstash Redis, or KV_REST_API_URL / KV_REST_API_TOKEN) and the state
// is loaded from Redis at the start of every request and saved after every write.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = "cuida:state:v1";

export const persistent = () => !!(URL_ && TOKEN);

export type Persisted = {
  doses: unknown[];
  vitals: unknown[];
  questions: { [k: string]: string[] };
  refills: unknown[];
  feed: unknown[];
};

export async function loadPersisted(): Promise<Persisted | null> {
  if (!persistent()) return null;
  try {
    const res = await fetch(`${URL_}/get/${KEY}`, { headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const j = (await res.json()) as { result: string | null };
    return j.result ? (JSON.parse(j.result) as Persisted) : null;
  } catch (e) {
    console.log(`[store] load failed, using memory: ${String(e).slice(0, 100)}`);
    return null;
  }
}

export async function savePersisted(p: Persisted) {
  if (!persistent()) return;
  try {
    const res = await fetch(`${URL_}/set/${KEY}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(p)),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) console.log(`[store] save failed: ${res.status}`);
  } catch (e) {
    console.log(`[store] save failed: ${String(e).slice(0, 100)}`);
  }
}
