import { Daytona, type Sandbox } from "@daytonaio/sdk";

// Lab trend analysis runs as Python inside a Daytona sandbox. The sandbox is created once
// per server process (or reused via DAYTONA_SANDBOX_ID) and kept warm.
const PY = (payloadB64: string) => `
import json, base64
from datetime import date
lab = json.loads(base64.b64decode("${payloadB64}").decode())
pts = [(date.fromisoformat(d), float(v)) for d, v in lab["series"]]
t0 = pts[0][0]
xs = [((d - t0).days) / 365.25 for d, _ in pts]
ys = [v for _, v in pts]
n = len(xs); mx = sum(xs)/n; my = sum(ys)/n
den = sum((x-mx)**2 for x in xs) or 1
slope = sum((x-mx)*(y-my) for x, y in zip(xs, ys)) / den
first, last = ys[0], ys[-1]
change = last - first
pct = (change / first) * 100 if first else 0
gmax, gmin = lab.get("goalMax"), lab.get("goalMin")
at_goal = (gmax is None or last < gmax) and (gmin is None or last > gmin)
lower_is_better = gmax is not None
improving = (slope < 0) if lower_is_better else (slope > 0)
if abs(slope) < 0.02 * (abs(my) or 1): direction = "steady"
else: direction = "improving" if improving else "getting worse"
if gmin is not None and gmax is None: direction = "steady" if abs(change) <= 5 else direction
print(json.dumps({
  "test": lab["label"], "unit": lab["unit"], "goal": lab["goal"],
  "first": {"date": str(pts[0][0]), "value": first},
  "latest": {"date": str(pts[-1][0]), "value": last},
  "change": round(change, 2), "percent_change": round(pct, 1),
  "slope_per_year": round(slope, 2), "direction": direction, "at_goal": at_goal,
  "readings": len(ys), "series": [{"date": str(d), "value": v} for d, v in pts]
}))
`;

const g = globalThis as unknown as { __cuidaSandbox?: Promise<Sandbox> };

export const daytonaConfigured = () => !!process.env.DAYTONA_API_KEY;

export function getSandbox(): Promise<Sandbox> {
  if (!g.__cuidaSandbox) {
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
    g.__cuidaSandbox = (async () => {
      if (process.env.DAYTONA_SANDBOX_ID) {
        const sb = await daytona.get(process.env.DAYTONA_SANDBOX_ID);
        if (sb.state !== "started") await sb.start();
        return sb;
      }
      return daytona.create({ language: "python", autoStopInterval: 30, labels: { app: "cuida" } });
    })().catch((e) => {
      g.__cuidaSandbox = undefined;
      throw e;
    });
  }
  return g.__cuidaSandbox;
}

export type TrendLab = { label: string; unit: string; goal: string; goalMax?: number; goalMin?: number; series: (string | number)[][] };

export async function analyzeTrend(lab: TrendLab) {
  const payload = Buffer.from(JSON.stringify(lab)).toString("base64");
  const sb = await getSandbox();
  const res = await sb.process.codeRun(PY(payload));
  if (res.exitCode !== 0) throw new Error(res.result);
  return { sandboxId: sb.id, result: JSON.parse(res.result.trim().split("\n").pop()!) };
}
