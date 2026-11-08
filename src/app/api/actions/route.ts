import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export type CareAction = {
  id: string;
  kind: "family_message" | "refill_request";
  title: string;
  body: string;
  urgency?: "fyi" | "soon" | "urgent";
  to: string;
  ts: number;
  sms?: "sent" | "skipped" | "failed";
};

const g = globalThis as unknown as { __cuidaActions?: CareAction[] };
const store = () => (g.__cuidaActions ??= []);

// Optional: real SMS to the family member's phone through Twilio.
async function sendSms(text: string): Promise<CareAction["sms"]> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from, FAMILY_PHONE: to } = process.env;
  if (!sid || !tok || !from || !to) return "skipped";
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: text }),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

export async function GET() {
  return NextResponse.json(store());
}

export async function DELETE() {
  g.__cuidaActions = [];
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const b = await req.json();
  const action: CareAction = {
    id: crypto.randomUUID(),
    kind: b.kind,
    title: b.title,
    body: b.body,
    urgency: b.urgency,
    to: b.to,
    ts: Date.now(),
  };
  if (action.kind === "family_message") action.sms = await sendSms(`cuida · about Mom: ${action.body}`);
  store().unshift(action);
  return NextResponse.json(action);
}
