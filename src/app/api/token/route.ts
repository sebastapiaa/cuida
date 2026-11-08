import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Mints a short-lived WebRTC conversation token so the API key never touches the browser.
// If no API key is configured, the client falls back to connecting with the public agent id.
export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!key || !agentId) return NextResponse.json({ token: null });
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": key }, cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ token: null, error: `${res.status}` });
    const data = await res.json();
    return NextResponse.json({ token: data.token ?? null });
  } catch (e) {
    return NextResponse.json({ token: null, error: String(e) });
  }
}
