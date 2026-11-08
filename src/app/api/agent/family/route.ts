import { agentRoute, body } from "@/lib/agent-route";
import { emit, record } from "@/lib/platform";

export const dynamic = "force-dynamic";

async function sendSms(text: string) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from, FAMILY_PHONE: to } = process.env;
  if (!sid || !tok || !from || !to) return "not configured";
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: text }),
  }).catch(() => null);
  return res?.ok ? "sent" : "failed";
}

export const POST = agentRoute("notify_family", body, async ({ message, urgency = "fyi" }) => {
  if (!message) return { summary: "missing message", data: { error: "Need the message text for Ana." } };
  const ana = record.patient.family.find((f) => f.primary)!;
  const sms = await sendSms(`cuida${urgency === "urgent" ? " URGENT" : ""} · Mom: ${message}`);
  emit({ kind: "family_message", summary: message, detail: { to: ana.name, urgency, sms } });
  return { summary: `text → ${ana.name} (${urgency})`, data: { sent_to: `${ana.name} (${ana.relation})`, urgency, sms } };
});
