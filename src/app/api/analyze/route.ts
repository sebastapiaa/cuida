import { NextResponse } from "next/server";
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import rosa from "@/data/rosa.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LabKey = keyof typeof rosa.labs;

// The analysis itself is Python that runs inside a Daytona sandbox.
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
  "readings": len(ys)
}))
`;

const g = globalThis as unknown as { __cuidaSandbox?: Promise<Sandbox> };

function getSandbox(): Promise<Sandbox> {
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

// GET pre-warms the sandbox when the demo page loads, so the first voice tool call is fast.
export async function GET() {
  if (!process.env.DAYTONA_API_KEY) return NextResponse.json({ engine: "local", ready: true });
  const t = Date.now();
  try {
    const sb = await getSandbox();
    return NextResponse.json({ engine: "daytona", ready: true, sandboxId: sb.id, ms: Date.now() - t });
  } catch (e) {
    return NextResponse.json({ engine: "daytona", ready: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { test } = (await req.json()) as { test: LabKey };
  const lab = rosa.labs[test];
  if (!lab) return NextResponse.json({ error: `Unknown test ${test}` }, { status: 400 });
  const payload = Buffer.from(JSON.stringify(lab)).toString("base64");
  const t = Date.now();

  if (!process.env.DAYTONA_API_KEY) {
    return NextResponse.json({ engine: "local", ms: 0, error: "DAYTONA_API_KEY not set" }, { status: 503 });
  }
  try {
    const sb = await getSandbox();
    const res = await sb.process.codeRun(PY(payload));
    if (res.exitCode !== 0) throw new Error(res.result);
    const out = JSON.parse(res.result.trim().split("\n").pop()!);
    return NextResponse.json({ engine: "daytona", sandboxId: sb.id, ms: Date.now() - t, result: out });
  } catch (e) {
    return NextResponse.json({ engine: "daytona", error: String(e), ms: Date.now() - t }, { status: 500 });
  }
}
