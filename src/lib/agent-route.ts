import { NextResponse } from "next/server";
import { emit, nowText, todayISO } from "@/lib/platform";

// Wraps every agent-facing endpoint: shared-secret check, timing, stdout log, and a feed event
// so the demo screen shows each tool call the ElevenLabs agent makes.
// Contract for the voice agent: always 200 JSON, fast. Problems come back as { error } with 200
// so the agent can recover in conversation. Only a wrong key is a 401.
export function agentRoute<A>(
  tool: string,
  parse: (req: Request) => Promise<A>,
  run: (args: A) => Promise<{ data: unknown; summary: string }>
) {
  return async (req: Request) => {
    const t = performance.now();
    const path = new URL(req.url).pathname + (new URL(req.url).search || "");
    const done = (status: number, payload: object) => {
      const ms = Math.round(performance.now() - t);
      console.log(`${req.method} ${path} ${status} ${ms}ms`);
      return NextResponse.json(payload, { status });
    };
    const key = process.env.CUIDA_AGENT_KEY;
    if (key && req.headers.get("x-cuida-key") !== key) return done(401, { error: "unauthorized" });

    let args: A;
    try {
      args = await parse(req);
    } catch {
      args = {} as A;
    }
    if (args === null || typeof args !== "object") args = {} as A;
    try {
      const { data, summary } = await run(args);
      const ms = Math.round(performance.now() - t);
      emit({ kind: "tool_call", tool, args, ms, summary });
      return done(200, { now: nowText(), today: todayISO(), ...(data as object) });
    } catch (e) {
      const ms = Math.round(performance.now() - t);
      const msg = e instanceof Error ? e.message : String(e);
      emit({ kind: "tool_call", tool, args, ms, summary: `error: ${msg}` });
      return done(200, { now: nowText(), today: todayISO(), error: `Could not complete ${tool}: ${msg}. Tell Rosa you could not look that up right now and offer to try again.` });
    }
  };
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());
export const body = async (req: Request): Promise<Record<string, string>> => {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
};
