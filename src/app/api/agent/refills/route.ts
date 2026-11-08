import { agentRoute, body } from "@/lib/agent-route";
import { emit, findMed, record, state } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const POST = agentRoute("request_refill", body, async ({ medication }) => {
  const m = findMed(medication);
  if (!m || !m.lastFilled) return { summary: `cannot refill ${medication}`, data: { error: `${medication} is not a prescription on Rosa's list.` } };
  const s = state();
  if (s.refills.some((r) => r.medId === m.id)) return { summary: "already requested", data: { already_requested: true, medication: m.name } };
  s.refills.push({ medId: m.id, ts: Date.now() });
  const ph = record.careTeam.find((c) => c.role === "Pharmacy")!;
  const needsRx = m.refillsLeft === 0;
  emit({ kind: "refill_requested", summary: `${m.name} ${m.dose} → ${ph.name}${needsRx ? ` + ${m.prescriber}` : ""}`, detail: { medication: m.name, pharmacy: ph.name, prescriber: needsRx ? m.prescriber : null } });
  return {
    summary: `${m.name} refill sent`,
    data: {
      medication: `${m.name} ${m.dose}`, sent_to: ph.name, pharmacy_phone: ph.phone, pharmacy_hours: ph.hours,
      prescriber_approval_requested_from: needsRx ? m.prescriber : null,
      expected: needsRx ? "Doctor approval usually takes 1 business day, then the pharmacy fills it the same day." : "Usually ready within 1 day.",
      copay: m.id === "apixaban" ? "$47 for 30 days" : "$0",
    },
  };
});
