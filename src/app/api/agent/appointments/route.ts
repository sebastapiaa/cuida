import { agentRoute, query } from "@/lib/agent-route";
import { daysBetween, record, spoken, state, todayISO } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const GET = agentRoute("get_appointments", async (r) => query(r), async ({ range = "upcoming" }) => {
  const today = todayISO();
  if (range === "past") {
    return { summary: "past visits", data: { past_visits: record.visits.map((v) => ({ date: spoken(v.date), with: v.with, summary: v.summary })) } };
  }
  let ap = record.appointments.filter((a) => a.date >= today);
  if (range === "next") ap = ap.slice(0, 1);
  const qs = state().questions;
  return {
    summary: ap.map((a) => `${a.with} ${a.date}`).join(" · "),
    data: {
      appointments: ap.map((a) => ({ appointment_id: a.id, when: `${spoken(a.date)} at ${a.time}`, in_days: daysBetween(today, a.date), what: a.type, with: a.with, where: a.where, prep: a.prep, questions_to_ask: qs[a.id] ?? [] })),
    },
  };
});
