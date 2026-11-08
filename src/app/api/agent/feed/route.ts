import { NextResponse } from "next/server";
import { resetState, state } from "@/lib/platform";

export const dynamic = "force-dynamic";

// Read by the demo screen (no agent key needed). DELETE resets the demo.
export async function GET() {
  const s = state();
  const { docs, passages } = await s.ready;
  return NextResponse.json({
    feed: s.feed,
    doses: s.doses,
    vitals: s.vitals,
    questions: s.questions,
    refills: s.refills,
    index: { documents: docs.length, passages: passages.length },
  });
}

export async function DELETE() {
  resetState();
  return NextResponse.json({ ok: true });
}
