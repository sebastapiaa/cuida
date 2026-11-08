import { NextResponse } from "next/server";
import { daytonaConfigured, getSandbox } from "@/lib/daytona";

export const dynamic = "force-dynamic";

// Pre-warms the Daytona sandbox so the agent's first lab analysis is fast.
export async function GET() {
  if (!daytonaConfigured()) return NextResponse.json({ engine: "none", ready: false });
  const t = Date.now();
  try {
    const sb = await getSandbox();
    return NextResponse.json({ engine: "daytona", ready: true, sandboxId: sb.id, ms: Date.now() - t });
  } catch (e) {
    return NextResponse.json({ engine: "daytona", ready: false, error: String(e) }, { status: 500 });
  }
}
