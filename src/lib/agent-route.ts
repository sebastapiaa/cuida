import { NextResponse } from "next/server";
import { emit, nowText, todayISO } from "@/lib/platform";

// Wraps every agent-facing endpoint: shared-secret check, timing, and a feed event
// so the demo screen shows each tool call the ElevenLabs agent makes.
export function agentRoute<A>(
  tool: string,
  parse: (req: Request) => Promise<A>,
  run: (args: A) => Promise<{ data: unknown; summary: string }>
) {
  return async (req: Request) => {
    const key = process.env.CUIDA_AGENT_KEY;
    if (key && req.headers.get("x-cuida-key") !== key) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const t = performance.now();
    let args: A;
    try {
      args = await parse(req);
    } catch {
      return NextResponse.json({ error: "bad request" }, { status: 400 });
    }
    try {
      const { data, summary } = await run(args);
      const ms = Math.round(performance.now() - t);
      emit({ kind: "tool_call", tool, args, ms, summary });
      return NextResponse.json({ now: nowText(), today: todayISO(), ...(data as object) });
    } catch (e) {
      const ms = Math.round(performance.now() - t);
      emit({ kind: "tool_call", tool, args, ms, summary: `error: ${String(e)}` });
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  };
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());
export const body = async (req: Request) => (await req.json()) as Record<string, string>;
