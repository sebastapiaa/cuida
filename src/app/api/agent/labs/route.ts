import { agentRoute, body } from "@/lib/agent-route";
import { record } from "@/lib/platform";
import { cachedTrend, computeAndCache, daytonaConfigured, refreshTrend, type TrendLab } from "@/lib/daytona";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type LabKey = keyof typeof record.labs;

// Same math as the Daytona Python, used only if the sandbox is unavailable (labeled engine: "local").
function localTrend(lab: TrendLab) {
  const s = lab.series as [string, number][];
  const first = s[0][1], last = s.at(-1)![1];
  const lower = lab.goalMax !== undefined;
  const change = +(last - first).toFixed(2);
  return {
    test: lab.label, unit: lab.unit, goal: lab.goal,
    first: { date: s[0][0], value: first }, latest: { date: s.at(-1)![0], value: last },
    change, percent_change: +((change / first) * 100).toFixed(1),
    direction: Math.abs(change) < 0.02 * first ? "steady" : (change < 0) === lower ? "improving" : "getting worse",
    at_goal: (lab.goalMax === undefined || last < lab.goalMax) && (lab.goalMin === undefined || last > lab.goalMin),
    readings: s.length, series: s.map(([date, value]) => ({ date, value })),
  };
}

export const POST = agentRoute("analyze_lab_trend", body, async ({ test }) => {
  const lab = test ? (record.labs[test as LabKey] as TrendLab | undefined) : undefined;
  if (!lab) return { summary: `unknown test ${test}`, data: { error: `Unknown test. Use one of: ${Object.keys(record.labs).join(", ")}` } };
  if (daytonaConfigured()) {
    // Served from the sandbox result computed at boot (or the last call); refreshed in the background.
    const hit = cachedTrend(test);
    if (hit) {
      refreshTrend(test, lab);
      const r = hit.result as { first: { value: number }; latest: { value: number }; unit: string; direction: string };
      return { summary: `${r.first.value} → ${r.latest.value} ${r.unit} · ${r.direction} · daytona (cached)`, data: { engine: "daytona", sandbox_id: hit.sandboxId, computed_at: hit.computedAt, ...hit.result } };
    }
    // Cold path: Daytona gets at most 6 seconds; otherwise the same math from the local engine.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("daytona timeout (6s)")), 6000)));
    try {
      const { result, sandboxId } = await Promise.race([computeAndCache(test, lab), timeout]);
      const r = result as { first: { value: number }; latest: { value: number }; unit: string; direction: string };
      return { summary: `${r.first.value} → ${r.latest.value} ${r.unit} · ${r.direction} · daytona`, data: { engine: "daytona", sandbox_id: sandboxId, ...result } };
    } catch (e) {
      console.log(`[labs] daytona unavailable, using local engine: ${String(e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const r = localTrend(lab);
  return { summary: `${r.first.value} → ${r.latest.value} ${r.unit} · ${r.direction} · local`, data: { engine: "local", ...r } };
});
