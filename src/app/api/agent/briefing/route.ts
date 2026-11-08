import { agentRoute } from "@/lib/agent-route";
import { daysBetween, record, runsOut, spoken, state, todayISO } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const GET = agentRoute("get_daily_briefing", async () => ({}), async () => {
  const s = state();
  const today = todayISO();
  const taken = s.doses.filter((d) => d.date === today);
  const meds = record.medications.filter((m) => !m.schedule.includes("as needed")).map((m) => ({
    name: `${m.name} ${m.dose}`,
    when: m.schedule,
    looks_like: m.appearance,
    taken_today: taken.filter((d) => d.medId === m.id).map((d) => d.time_of_day),
  }));
  const soon = record.appointments.filter((a) => a.date >= today && daysBetween(today, a.date) <= 10).map((a) => ({
    when: `${spoken(a.date)} at ${a.time}`, in_days: daysBetween(today, a.date), what: a.type, with: a.with, prep: a.prep,
  }));
  const refillAlerts = record.medications.flatMap((m) => {
    const out = runsOut(m);
    if (!out) return [];
    const days = daysBetween(today, out);
    const requested = s.refills.some((r) => r.medId === m.id);
    return days <= 10 ? [{ medication: m.name, runs_out: spoken(out), days_left: days, refills_left: m.refillsLeft, refill_already_requested: requested }] : [];
  });
  return {
    summary: `${soon.length} appts soon · ${refillAlerts.length} refill alerts`,
    data: { patient: record.patient.preferredName, medications_today: meds, appointments_next_10_days: soon, refill_alerts: refillAlerts, home_readings_today: s.vitals.filter((v) => new Date(v.ts).toISOString().slice(0, 10) === today) },
  };
});
