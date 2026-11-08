import { agentRoute, body } from "@/lib/agent-route";
import { emit, findMed, record, state, todayISO } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const POST = agentRoute("log_dose", body, async ({ medication, time_of_day }) => {
  const s = state();
  const today = todayISO();
  const meds = /all|todas|everything/i.test(medication)
    ? record.medications.filter((m) => m.schedule.includes(time_of_day))
    : [findMed(medication)].filter(Boolean) as typeof record.medications;
  if (!meds.length) return { summary: `unknown med: ${medication}`, data: { error: `${medication} is not on Rosa's medication list.` } };
  const logged: string[] = [], already: string[] = [];
  for (const m of meds) {
    if (s.doses.some((d) => d.medId === m.id && d.date === today && d.time_of_day === time_of_day)) { already.push(m.name); continue; }
    s.doses.push({ medication: m.name, medId: m.id, time_of_day, date: today, ts: Date.now() });
    logged.push(m.name);
  }
  if (logged.length) emit({ kind: "dose_logged", summary: `${logged.join(", ")} · ${time_of_day}`, detail: { logged, time_of_day } });
  return { summary: `logged ${logged.length}`, data: { logged, already_logged_today: already, time_of_day } };
});
