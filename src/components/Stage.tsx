"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { buildChunks, createIndex, prettyDate, record, type Chunk } from "@/lib/records";
import type { CareAction } from "@/app/api/actions/route";
import {
  BoltIcon,
  CheckIcon,
  MicIcon,
  AlertIcon,
  kindIcon,
} from "./icons";

/* ------------------------------------------------------------------ */
/* Record index (built once, in the browser, from Rosa's fake record)  */
/* ------------------------------------------------------------------ */
const CHUNKS = buildChunks();
const INDEX = createIndex(CHUNKS);
const byId = (id: string) => CHUNKS.find((c) => c.id === id)!;

type LabKey = keyof typeof record.labs;
type Trace = {
  id: string;
  tool: string;
  args: string;
  ms: number;
  engine: "browser index" | "daytona sandbox" | "local fallback" | "server action";
  preview: string;
  ok: boolean;
};
type Line = { role: "user" | "agent"; text: string; id: number };
type Surfaced = { chunk: Chunk; trend?: TrendResult; at: number };
type TrendResult = {
  test: string;
  unit: string;
  goal: string;
  first: { date: string; value: number };
  latest: { date: string; value: number };
  change: number;
  percent_change: number;
  direction: string;
  at_goal: boolean;
};

const today = () => new Date();
const isoToday = () => {
  const d = today();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const runsOut = (m: (typeof record.medications)[number]) => {
  if (!m.lastFilled) return null;
  const d = new Date(m.lastFilled + "T12:00:00");
  d.setDate(d.getDate() + m.daysSupply);
  return d;
};
const daysUntil = (d: Date) => Math.ceil((d.getTime() - today().getTime()) / 86400000);

function localTrend(key: LabKey): TrendResult {
  const lab = record.labs[key] as { label: string; unit: string; goal: string; goalMax?: number; goalMin?: number; series: (string | number)[][] };
  const s = lab.series as [string, number][];
  const first = s[0], last = s[s.length - 1];
  const change = +(last[1] - first[1]).toFixed(2);
  const lowerBetter = lab.goalMax !== undefined;
  const atGoal = (lab.goalMax === undefined || last[1] < lab.goalMax) && (lab.goalMin === undefined || last[1] > lab.goalMin);
  return {
    test: lab.label, unit: lab.unit, goal: lab.goal,
    first: { date: first[0], value: first[1] }, latest: { date: last[0], value: last[1] },
    change, percent_change: +((change / first[1]) * 100).toFixed(1),
    direction: change === 0 ? "steady" : (change < 0) === lowerBetter ? "improving" : "getting worse",
    at_goal: atGoal,
  };
}

/* ------------------------------------------------------------------ */
export default function Stage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [surfaced, setSurfaced] = useState<Surfaced[]>([]);
  const [actions, setActions] = useState<CareAction[]>([]);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [engine, setEngine] = useState<"daytona" | "local" | "warming">("warming");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const userEndAt = useRef<number | null>(null);
  const lineId = useRef(0);

  const trace = useCallback((t: Omit<Trace, "id">) => {
    setTraces((p) => [{ ...t, id: crypto.randomUUID() }, ...p].slice(0, 40));
  }, []);
  const surface = useCallback((items: Surfaced[]) => {
    if (items.length) setSurfaced(items);
  }, []);

  // Pre-warm the Daytona sandbox + load prior actions
  useEffect(() => {
    fetch("/api/analyze").then((r) => r.json()).then((d) => setEngine(d.engine === "daytona" && d.ready ? "daytona" : "local")).catch(() => setEngine("local"));
    fetch("/api/actions").then((r) => r.json()).then(setActions).catch(() => {});
  }, []);

  /* ---------------- client tools (run in the browser) ---------------- */
  const clientTools = useMemo(
    () => ({
      search_records: async ({ query }: { query: string }) => {
        const t = performance.now();
        const hits = INDEX.search(query, 3);
        const ms = performance.now() - t;
        surface(hits.map((h) => ({ chunk: h.chunk, at: Date.now() })));
        trace({ tool: "search_records", args: `"${query}"`, ms, engine: "browser index", preview: hits.map((h) => h.chunk.title).join(" · ") || "no match", ok: hits.length > 0 });
        if (!hits.length) return "No matching record found. Tell Rosa honestly that her records do not say.";
        return JSON.stringify({ today: isoToday(), results: hits.map((h) => ({ title: h.chunk.title, details: h.chunk.text, source: h.chunk.source })) });
      },

      get_medication_schedule: async ({ time_of_day }: { time_of_day: string }) => {
        const t = performance.now();
        const meds = record.medications.filter((m) => time_of_day === "all" || m.schedule.includes(time_of_day));
        surface(meds.map((m) => ({ chunk: byId(m.id), at: Date.now() })));
        trace({ tool: "get_medication_schedule", args: time_of_day, ms: performance.now() - t, engine: "browser index", preview: meds.map((m) => m.name.split(" ")[0]).join(", "), ok: true });
        return JSON.stringify(
          meds.map((m) => {
            const out = runsOut(m);
            return { name: m.name, dose: m.dose, purpose: m.purpose, how: m.howToTake, looks_like: m.appearance, refills_left: m.refillsLeft, runs_out: out ? out.toDateString() : null };
          })
        );
      },

      get_appointments: async ({ range }: { range: string }) => {
        const t = performance.now();
        const now = isoToday();
        let items: Chunk[];
        if (range === "past") items = record.visits.map((v) => byId(v.id));
        else {
          const up = record.appointments.filter((a) => a.date >= now).map((a) => byId(a.id));
          items = range === "next" ? up.slice(0, 1) : up;
        }
        surface(items.map((c) => ({ chunk: c, at: Date.now() })));
        trace({ tool: "get_appointments", args: range, ms: performance.now() - t, engine: "browser index", preview: items.map((c) => c.subtitle.split(" · ")[0]).join(" · "), ok: true });
        return JSON.stringify({ today: now, items: items.map((c) => c.text) });
      },

      analyze_lab_trend: async ({ test }: { test: string }) => {
        const key = test as LabKey;
        if (!record.labs[key]) return `Unknown test ${test}.`;
        const t = performance.now();
        let result: TrendResult;
        let eng: Trace["engine"] = "daytona sandbox";
        try {
          const r = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test }) });
          const d = await r.json();
          if (!r.ok || !d.result) throw new Error(d.error || "sandbox error");
          result = d.result;
        } catch {
          result = localTrend(key);
          eng = "local fallback";
        }
        const ms = performance.now() - t;
        surface([{ chunk: byId(`lab-${key}`), trend: result, at: Date.now() }]);
        trace({ tool: "analyze_lab_trend", args: test, ms, engine: eng, preview: `${result.first.value} → ${result.latest.value} ${result.unit} · ${result.direction}`, ok: true });
        return JSON.stringify(result);
      },

      request_refill: async ({ medication }: { medication: string }) => {
        const t = performance.now();
        const q = medication.toLowerCase();
        const med = record.medications.find((m) => m.name.toLowerCase().includes(q) || m.id.includes(q) || q.includes(m.id));
        if (!med) return `Could not find ${medication} in Rosa's medication list.`;
        const pharmacy = record.careTeam.find((c) => c.role === "Pharmacy")!;
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "refill_request", title: `Refill: ${med.name} ${med.dose}`, body: `Sent to ${pharmacy.name} and ${med.prescriber}'s office`, to: pharmacy.name }),
        });
        const action: CareAction = await res.json();
        setActions((p) => [action, ...p]);
        surface([{ chunk: byId(med.id), at: Date.now() }]);
        trace({ tool: "request_refill", args: med.name, ms: performance.now() - t, engine: "server action", preview: `→ ${pharmacy.name} + ${med.prescriber}`, ok: true });
        return `Refill request for ${med.name} ${med.dose} sent to ${pharmacy.name} (${pharmacy.address}, ${pharmacy.phone}) and to ${med.prescriber}'s office for approval. Usually ready in 1 to 2 business days.`;
      },

      notify_family: async ({ message, urgency }: { message: string; urgency: "fyi" | "soon" | "urgent" }) => {
        const t = performance.now();
        const ana = record.patient.family.find((f) => f.primary)!;
        const res = await fetch("/api/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "family_message", title: "Message to Ana", body: message, urgency, to: ana.name }),
        });
        const action: CareAction = await res.json();
        setActions((p) => [action, ...p]);
        trace({ tool: "notify_family", args: urgency, ms: performance.now() - t, engine: "server action", preview: `text → ${ana.name}${action.sms === "sent" ? " (SMS delivered)" : ""}`, ok: true });
        return `Text sent to ${ana.name}.`;
      },
    }),
    [surface, trace]
  );

  // Handy for testing tools from the browser console before the agent is set up: __cuida.search_records({query:"pink pill"})
  useEffect(() => {
    (window as unknown as { __cuida: typeof clientTools }).__cuida = clientTools;
  }, [clientTools]);

  const conversation = useConversation({
    clientTools,
    onConnect: () => setError(null),
    onError: (m: string) => setError(String(m)),
    onMessage: (m) => {
      const role: Line["role"] = m.role === "user" || m.source === "user" ? "user" : "agent";
      if (role === "user") userEndAt.current = performance.now();
      setLines((p) => [...p, { role, text: m.message, id: ++lineId.current }].slice(-30));
    },
    onModeChange: ({ mode }) => {
      if (mode === "speaking" && userEndAt.current != null) {
        const ms = performance.now() - userEndAt.current;
        userEndAt.current = null;
        if (ms > 0 && ms < 15000) setLatencies((p) => [...p, ms].slice(-20));
      }
    },
  });

  const { status, isSpeaking } = conversation;
  const connected = status === "connected";

  const start = async () => {
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { token } = await fetch("/api/token").then((r) => r.json()).catch(() => ({ token: null }));
      const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
      if (!token && !agentId) {
        setError("Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local (run npm run setup:agent).");
        return;
      }
      const d = today();
      conversation.startSession({
        ...(token ? { conversationToken: token, connectionType: "webrtc" as const } : { agentId: agentId!, connectionType: "webrtc" as const }),
        onConnect: () => {
          conversation.sendContextualUpdate(
            `Today is ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} Pacific time.`
          );
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = async () => {
    await fetch("/api/actions", { method: "DELETE" });
    setActions([]); setTraces([]); setLines([]); setSurfaced([]); setLatencies([]);
  };

  /* ---------------- live volume for the orb ---------------- */
  const orbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (orbRef.current) {
        let v = 0;
        if (connected) {
          try { v = isSpeaking ? conversation.getOutputVolume() : conversation.getInputVolume(); } catch { v = 0; }
        }
        orbRef.current.style.setProperty("--v", String(Math.min(1, v * 2.2)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, isSpeaking, conversation]);

  const lastAgent = [...lines].reverse().find((l) => l.role === "agent");
  const lastUser = [...lines].reverse().find((l) => l.role === "user");
  const lastLatency = latencies.at(-1);
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : undefined;

  const lowMeds = record.medications
    .map((m) => ({ m, out: runsOut(m) }))
    .filter((x) => x.out && x.m.refillsLeft === 0 && daysUntil(x.out) <= 10)
    .filter((x) => !actions.some((a) => a.kind === "refill_request" && a.title.includes(x.m.name)));

  const hour = today().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="stage">
      {/* ---------- header ---------- */}
      <header className="flex items-end justify-between px-10 pt-7 pb-5">
        <div className="flex items-baseline gap-4">
          <h1 className="wordmark">cuida</h1>
          <p className="text-[15px] text-ink-2">Every health record, answered out loud. For the parents we take care of.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip"><span className={`dot ${connected ? "dot-live" : ""}`} />ElevenLabs Agent · {connected ? "live" : status}</span>
          <span className="chip"><BoltIcon width={13} height={13} />Daytona {engine === "daytona" ? "sandbox ready" : engine === "warming" ? "warming…" : "not configured"}</span>
          <span className="chip">Track 03 · Health &amp; Care · fake data</span>
        </div>
      </header>

      <main className="grid grid-cols-[400px_minmax(0,1fr)_330px] gap-8 px-10 pb-8 min-h-0 flex-1">
        {/* ================= Rosa's phone ================= */}
        <section className="flex flex-col items-center min-h-0">
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              <div className="statusbar"><span>{today().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span><span>●●● 5G ▮</span></div>

              <div className="px-6 pt-3">
                <p className="text-[13px] uppercase tracking-[0.14em] text-ink-3">{today().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
                <h2 className="font-display text-[34px] leading-[1.05] mt-1">{greeting},<br />Rosa</h2>
              </div>

              {/* Orb */}
              <div className="flex flex-col items-center mt-7">
                <button onClick={connected ? () => conversation.endSession() : start} className="orb-btn" aria-label={connected ? "End" : "Talk to cuida"}>
                  <div ref={orbRef} className={`orb ${connected ? (isSpeaking ? "orb-speaking" : "orb-listening") : ""}`}>
                    {!connected && <MicIcon width={44} height={44} strokeWidth={1.6} />}
                  </div>
                </button>
                <p className="mt-9 text-[17px] font-medium">
                  {status === "connecting" ? "Connecting…" : !connected ? "Tap to talk to cuida" : isSpeaking ? "cuida is speaking" : "Listening…"}
                </p>
              </div>

              {/* Caption or idle cards */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-6 space-y-3 no-scrollbar">
                {connected || lines.length || surfaced.length ? (
                  <>
                    {lastUser && <p className="text-[15px] text-ink-3 italic px-1">“{lastUser.text}”</p>}
                    {lastAgent && <p key={lastAgent.id} className="caption fade-in">{lastAgent.text}</p>}
                    {surfaced.length > 0 && (
                      <div className="pt-1 space-y-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-ink-3 px-1">From your records</p>
                        {surfaced.map((s, i) => <RecordCard key={s.chunk.id + s.at} s={s} delay={i * 70} />)}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {lowMeds.map(({ m, out }) => (
                      <div key={m.id} className="alert-card">
                        <AlertIcon width={20} height={20} />
                        <div>
                          <p className="font-semibold text-[16px]">{m.name.split(" (")[0]} runs out {out!.toLocaleDateString("en-US", { weekday: "long" })}</p>
                          <p className="text-[14px] opacity-80">No refills left. Ask cuida to request one.</p>
                        </div>
                      </div>
                    ))}
                    <div className="soft-card">
                      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Next visit</p>
                      <p className="font-display text-[21px] mt-1 leading-tight">{record.appointments[0].with}</p>
                      <p className="text-[15px] text-ink-2">{prettyDate(record.appointments[0].date).replace(/, \d{4}$/, "")} · {record.appointments[0].time}</p>
                    </div>
                    <div className="soft-card">
                      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Tonight</p>
                      {record.medications.filter((m) => m.schedule.includes("evening") || m.schedule.includes("bedtime")).map((m) => (
                        <div key={m.id} className="flex items-center gap-3 mt-2">
                          <span className={`pill-swatch pill-${m.id}`} />
                          <span className="text-[16px]">{m.name.split(" (")[0]} <span className="text-ink-3">{m.dose}</span></span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ================= Behind the scenes ================= */}
        <section className="panel min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-6 pt-5">
            <p className="eyebrow">Behind the scenes</p>
            <button onClick={reset} className="text-[12px] text-ink-3 hover:text-ink-1">reset demo</button>
          </div>

          <div className="grid grid-cols-3 gap-3 px-6 pt-4">
            <Metric label="Reply time (last)" value={lastLatency ? `${(lastLatency / 1000).toFixed(2)}s` : "–"} good={lastLatency !== undefined && lastLatency < 2000} />
            <Metric label="Reply time (avg)" value={avgLatency ? `${(avgLatency / 1000).toFixed(2)}s` : "–"} good={avgLatency !== undefined && avgLatency < 2000} />
            <Metric label="Records indexed" value={String(INDEX.size)} sub={`${record.medications.length} meds · ${Object.values(record.labs).reduce((a, l) => a + l.series.length, 0)} labs · ${record.visits.length} visits`} />
          </div>

          <div className="grid grid-cols-2 gap-5 px-6 pt-5 pb-5 min-h-0 flex-1">
            <div className="min-h-0 flex flex-col">
              <p className="sub-eyebrow">Tool calls</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 thin-scroll">
                {traces.length === 0 && <Empty text="Agent tool calls appear here with their run time." />}
                {traces.map((t) => (
                  <div key={t.id} className="trace fade-in">
                    <div className="flex items-center justify-between">
                      <code className="text-[13px] font-semibold">{t.tool}</code>
                      <span className="text-[12px] tabular-nums text-ink-3">{t.ms < 10 ? t.ms.toFixed(1) : Math.round(t.ms)} ms</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`engine engine-${t.engine.split(" ")[0]}`}>{t.engine}</span>
                      <code className="text-[12px] text-ink-2 truncate">{t.args}</code>
                    </div>
                    <p className="text-[12.5px] text-ink-2 mt-1 truncate">{t.preview}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex flex-col">
              <p className="sub-eyebrow">Transcript</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 thin-scroll flex flex-col-reverse">
                <div className="space-y-2">
                  {lines.length === 0 && <Empty text="Rosa talks in English or Spanish. cuida answers in the same language." />}
                  {lines.map((l) => (
                    <div key={l.id} className={`bubble ${l.role === "user" ? "bubble-user" : "bubble-agent"}`}>
                      <span className="who">{l.role === "user" ? "Rosa" : "cuida"}</span>
                      {l.text}
                    </div>
                  ))}
                </div>
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); if (typed.trim() && connected) { conversation.sendUserMessage(typed.trim()); setTyped(""); } }}
                className="mt-3 flex gap-2"
              >
                <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={connected ? "Type instead of talking…" : "Start the conversation first"} className="type-box" disabled={!connected} />
              </form>
            </div>
          </div>
          {error && <p className="mx-6 mb-4 text-[13px] text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </section>

        {/* ================= Ana's phone ================= */}
        <section className="flex flex-col items-center min-h-0">
          <p className="eyebrow self-start mb-3">Ana · daughter, 30 min away</p>
          <div className="phone phone-sm">
            <div className="phone-notch" />
            <div className="phone-screen bg-white">
              <div className="statusbar"><span>{today().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span><span>●●● 5G ▮</span></div>
              <div className="text-center pt-1 pb-3 border-b border-black/5">
                <div className="mx-auto w-11 h-11 rounded-full bg-[var(--terracotta)] text-white grid place-items-center font-display text-[20px]">c</div>
                <p className="text-[13px] font-semibold mt-1">cuida · Mom</p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5 no-scrollbar">
                {actions.filter((a) => a.kind === "family_message").length === 0 && (
                  <p className="text-center text-[12px] text-ink-3 pt-8 px-4">No texts today. Mom has not needed to call you.</p>
                )}
                {[...actions].reverse().filter((a) => a.kind === "family_message").map((a) => (
                  <div key={a.id} className="fade-in">
                    <div className={`sms ${a.urgency === "urgent" ? "sms-urgent" : ""}`}>
                      {a.urgency && a.urgency !== "fyi" && <span className="sms-tag">{a.urgency}</span>}
                      {a.body}
                    </div>
                    <p className="text-[10.5px] text-ink-3 mt-1 ml-1">
                      {new Date(a.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      {a.sms === "sent" ? " · delivered by SMS" : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="w-full mt-4 space-y-2">
            <p className="sub-eyebrow">Actions taken</p>
            {actions.filter((a) => a.kind === "refill_request").length === 0 && <Empty text="Refills and requests cuida sends show here." />}
            {actions.filter((a) => a.kind === "refill_request").map((a) => (
              <div key={a.id} className="action-card fade-in">
                <span className="check"><CheckIcon width={14} height={14} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">{a.title}</p>
                  <p className="text-[12.5px] text-ink-2">{a.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Metric({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className="metric">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p className={`font-display text-[30px] leading-none mt-2 tabular-nums ${good ? "text-[var(--sage-ink)]" : ""}`}>{value}</p>
      {sub && <p className="text-[11.5px] text-ink-3 mt-1.5">{sub}</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[13px] text-ink-3 border border-dashed border-black/10 rounded-xl px-3 py-3">{text}</p>;
}

function RecordCard({ s, delay }: { s: Surfaced; delay: number }) {
  const Icon = kindIcon[s.chunk.kind];
  const lab = s.chunk.kind === "lab" ? record.labs[s.chunk.id.replace("lab-", "") as LabKey] : null;
  return (
    <div className="record-card rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-3">
        <span className={`kind kind-${s.chunk.kind}`}><Icon width={17} height={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-snug">{s.chunk.title}</p>
          <p className="text-[14px] text-ink-2 leading-snug">{s.chunk.subtitle}</p>
        </div>
      </div>
      {lab && <Spark series={lab.series as [string, number][]} trend={s.trend} unit={lab.unit} />}
      <p className="text-[11.5px] text-ink-3 mt-2">{s.chunk.source}</p>
    </div>
  );
}

function Spark({ series, trend, unit }: { series: [string, number][]; trend?: TrendResult; unit: string }) {
  const w = 300, h = 54, pad = 6;
  const vs = series.map((p) => p[1]);
  const min = Math.min(...vs), max = Math.max(...vs);
  const pts = series.map((p, i) => [pad + (i * (w - 2 * pad)) / (series.length - 1), h - pad - ((p[1] - min) / (max - min || 1)) * (h - 2 * pad)]);
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[54px]">
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--terracotta)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 3} fill={i === pts.length - 1 ? "var(--terracotta)" : "white"} stroke="var(--terracotta)" strokeWidth="2" />)}
      </svg>
      {trend && (
        <p className="text-[13px] text-ink-2">
          {trend.first.value} → <b>{trend.latest.value} {unit}</b> · {trend.direction}{trend.at_goal ? " · at goal" : ""}
        </p>
      )}
    </div>
  );
}
