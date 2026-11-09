import { agentRoute, query } from "@/lib/agent-route";
import { daysBetween, record, runsOut, spoken, state, todayISO } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const GET = agentRoute("get_medications", async (r) => query(r), async ({ time_of_day = "all" }) => {
  const today = todayISO();
  const taken = state().doses.filter((d) => d.date === today);
  const meds = record.medications.filter((m) => time_of_day === "all" || m.schedule.includes(time_of_day));
  return {
    summary: meds.map((m) => m.name.split(" ")[0]).join(", "),
    data: {
      time_of_day,
      note: "Morning pills around 8 AM, evening around 6 PM, bedtime around 9 PM. Use 'now' to work out which dose is next.",
      medications: meds.map((m) => {
        const out = runsOut(m);
        return {
          name: m.name, dose: m.dose, when: m.schedule, purpose: m.purpose, how_to_take: m.howToTake, looks_like: m.appearance, prescriber: m.prescriber,
          notes: m.notes || undefined, refills_left: m.lastFilled ? m.refillsLeft : undefined,
          runs_out: out ? `${spoken(out)} (${daysBetween(today, out)} days)` : undefined,
          taken_today: taken.filter((d) => d.medId === m.id).map((d) => d.time_of_day),
        };
      }),
    },
  };
});
