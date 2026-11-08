"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { prettyDate, record } from "@/lib/records";
import type { FeedEvent } from "@/lib/platform";
import { BoltIcon, CheckIcon, MicIcon, AlertIcon, kindIcon } from "./icons";

/* ------------------------------------------------------------------ */
/* The demo screen reads everything from the platform: GET /api/agent/feed  */
/* holds every tool call the ElevenLabs agent made and every write     */
/* (doses, readings, questions, refills, texts). Nothing runs in the   */
/* browser except the voice connection itself.                         */
/* ------------------------------------------------------------------ */
type LabKey = keyof typeof record.labs;
type Med = (typeof record.medications)[number];
type Line = { role: "user" | "agent"; text: string; id: number };
type Trend = { first: { date: string; value: number }; latest: { date: string; value: number }; direction: string; at_goal: boolean; unit: string };
type Card = { id: string; kind: string; title: string; subtitle: string; source: string; lab?: LabKey; trend?: Trend; at: number };
type Feed = {
  feed: FeedEvent[];
  doses: { medication: string; medId: string; time_of_day: string; date: string; ts: number }[];
  vitals: { type: string; value: string; unit: string; ts: number; flag: string }[];
  questions: { [apptId: string]: string[] };
  refills: { medId: string; ts: number }[];
  index: { documents: number; passages: number };
};
const EMPTY: Feed = { feed: [], doses: [], vitals: [], questions: {}, refills: [], index: { documents: 0, passages: 0 } };

const today = () => new Date();
const runsOut = (m: Med) => {
  if (!m.lastFilled) return null;
  const d = new Date(m.lastFilled + "T12:00:00");
  d.setDate(d.getDate() + m.daysSupply);
  return d;
};
const daysUntil = (d: Date) => Math.ceil((d.getTime() - today().getTime()) / 86400000);
const medCard = (m: Med, at: number): Card => ({ id: m.id, kind: "medication", title: `${m.name} ${m.dose}`, subtitle: `${m.appearance} · ${m.schedule.join(" + ")}`, source: `Pharmacy medication list · ${m.prescriber}`, at });
const apptCard = (a: (typeof record.appointments)[number], at: number): Card => ({ id: a.id, kind: "appointment", title: a.type, subtitle: `${prettyDate(a.date)} · ${a.time}`, source: `Appointments · ${a.with}`, at });
const labCard = (key: LabKey, at: number, trend?: Trend): Card => {
  const lab = record.labs[key];
  const last = lab.series[lab.series.length - 1];
  return { id: `lab-${key}`, kind: "lab", title: lab.label, subtitle: `Latest ${last[1]} ${lab.unit} · ${last[0]}`, source: `Lab results · ${lab.goal}`, lab: key, trend, at };
};
const findMeds = (q: string, time?: string): Med[] => {
  const n = (q || "").toLowerCase();
  if (/all|todas|everything/.test(n)) return record.medications.filter((m) => !time || m.schedule.includes(time));
  return record.medications.filter((m) => n.includes(m.id) || m.name.toLowerCase().split(/\W+/).some((w) => w.length > 3 && n.includes(w)) || m.appearance.toLowerCase().split(" ").some((w) => w.length > 3 && n.includes(w)));
};

// What to show on Rosa's phone for each tool call the agent made
function cardsFor(e: FeedEvent): Card[] {
  const a = (e.args ?? {}) as Record<string, string>;
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const at = e.ts;
  switch (e.tool) {
    case "get_medications":
      return record.medications.filter((m) => !a.time_of_day || a.time_of_day === "all" || m.schedule.includes(a.time_of_day)).map((m) => medCard(m, at));
    case "log_dose":
    case "request_refill":
      return findMeds(a.medication, a.time_of_day).map((m) => medCard(m, at));
    case "get_appointments": {
      const now = today().toISOString().slice(0, 10);
      const up = record.appointments.filter((x) => x.date >= now);
      return (a.range === "next" ? up.slice(0, 1) : up).map((x) => apptCard(x, at));
    }
    case "add_question_for_doctor": {
      const saved = String(d.saved_to ?? "");
      const appt = record.appointments.find((x) => saved.includes(x.with)) ?? record.appointments[0];
      return [apptCard(appt, at)];
    }
    case "analyze_lab_trend":
      return a.test && record.labs[a.test as LabKey] ? [labCard(a.test as LabKey, at, d.first ? (d as unknown as Trend) : undefined)] : [];
    case "log_home_reading":
      return [{ id: `vital-${at}`, kind: "lab", title: `${String(a.type ?? "").replace("_", " ")} ${a.value}`, subtitle: `${String(d.flag ?? "").replace("_", " ")}${d.guidance ? " · " + String(d.guidance).slice(0, 80) : ""}`, source: "Home reading saved to your record", at }];
    case "search_records": {
      const results = (d.results as { document: string; from: string; date: string | null; excerpt: string }[] | undefined) ?? [];
      return results.slice(0, 3).map((r, i) => ({ id: `doc-${at}-${i}`, kind: "visit", title: r.document, subtitle: r.excerpt.replace(/\s+/g, " ").slice(0, 110) + (r.excerpt.length > 110 ? "…" : ""), source: `${r.from}${r.date ? " · " + r.date : ""}`, at }));
    }
    case "read_document":
      return d.title ? [{ id: `doc-${at}`, kind: "visit", title: String(d.title), subtitle: String(d.from ?? ""), source: d.date ? `Document · ${d.date}` : "Document", at }] : [];
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ */
export default function Stage() {
  const [data, setData] = useState<Feed>(EMPTY);
  const [lines, setLines] = useState<Line[]>([]);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [engine, setEngine] = useState<"daytona" | "local" | "warming">("warming");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const userEndAt = useRef<number | null>(null);
  const lineId = useRef(0);

  const conversation = useConversation({
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

  // Platform feed: poll fast while talking, slower when idle
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/feed", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {}
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, connected ? 700 : 2500);
    return () => clearInterval(id);
  }, [refresh, connected]);
  useEffect(() => {
    fetch("/api/analyze").then((r) => r.json()).then((d) => setEngine(d.engine === "daytona" && d.ready ? "daytona" : "local")).catch(() => setEngine("local"));
  }, []);

  const start = async () => {
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { token } = await fetch("/api/token").then((r) => r.json()).catch(() => ({ token: null }));
      const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
      if (!token && !agentId) {
        setError("Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID in .env.local (run npm run up).");
        return;
      }
      conversation.startSession(token ? { conversationToken: token, connectionType: "webrtc" as const } : { agentId: agentId!, connectionType: "webrtc" as const });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reset = async () => {
    await fetch("/api/agent/feed", { method: "DELETE" });
    setLines([]); setLatencies([]);
    refresh();
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

  /* ---------------- derived from the platform feed ---------------- */
  const toolCalls = useMemo(() => data.feed.filter((e) => e.kind === "tool_call"), [data.feed]);
  const texts = useMemo(() => data.feed.filter((e) => e.kind === "family_message"), [data.feed]);
  const actions = useMemo(() => data.feed.filter((e) => ["refill_requested", "question_added", "dose_logged", "vital_logged"].includes(e.kind)), [data.feed]);
  const surfaced = useMemo(() => {
    // the most recent tool call that has something to show, plus anything from the same second
    for (const e of toolCalls) {
      const cards = cardsFor(e);
      if (cards.length) return cards.slice(0, 4);
    }
    return [];
  }, [toolCalls]);

  const lastAgent = [...lines].reverse().find((l) => l.role === "agent");
  const lastUser = [...lines].reverse().find((l) => l.role === "user");
  const lastLatency = latencies.at(-1);
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : undefined;

  const lowMeds = record.medications
    .map((m) => ({ m, out: runsOut(m) }))
    .filter((x) => x.out && x.m.refillsLeft === 0 && daysUntil(x.out) <= 10)
    .filter((x) => !data.refills.some((r) => r.medId === x.m.id));

  const hour = today().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const todayISO = today().toISOString().slice(0, 10);
  const takenToday = data.doses.filter((d) => d.date === todayISO);

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
                        {surfaced.map((c, i) => <RecordCard key={c.id + c.at} c={c} delay={i * 70} />)}
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
                      <p className="text-[12px] uppercase tracking-[0.14em] text-ink-3">Today's pills</p>
                      {record.medications.filter((m) => !m.schedule.includes("as needed")).map((m) => {
                        const done = takenToday.filter((d) => d.medId === m.id).map((d) => d.time_of_day);
                        return (
                          <div key={m.id} className="flex items-center gap-3 mt-2">
                            <span className={`pill-swatch pill-${m.id}`} />
                            <span className="text-[16px] flex-1">{m.name.split(" (")[0]} <span className="text-ink-3">{m.dose}</span></span>
                            {done.length > 0 && <span className="text-[12px] text-[var(--sage-ink)] font-semibold">✓ {done.join(", ")}</span>}
                          </div>
                        );
                      })}
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
            <p className="eyebrow">Behind the scenes · the agent reads and writes the platform</p>
            <button onClick={reset} className="text-[12px] text-ink-3 hover:text-ink-1">reset demo</button>
          </div>

          <div className="grid grid-cols-3 gap-3 px-6 pt-4">
            <Metric label="Reply time (last)" value={lastLatency ? `${(lastLatency / 1000).toFixed(2)}s` : "–"} good={lastLatency !== undefined && lastLatency < 2000} />
            <Metric label="Tool calls" value={String(toolCalls.length)} sub={toolCalls.length ? `avg ${Math.round(toolCalls.reduce((a, e) => a + (e.ms ?? 0), 0) / toolCalls.length)} ms on the server` : avgLatency ? `reply avg ${(avgLatency / 1000).toFixed(2)}s` : "none yet"} />
            <Metric label="Records indexed" value={String(data.index.passages)} sub={`${data.index.documents} documents · ${record.medications.length} meds · ${Object.values(record.labs).reduce((a, l) => a + l.series.length, 0)} labs`} />
          </div>

          <div className="grid grid-cols-2 gap-5 px-6 pt-5 pb-5 min-h-0 flex-1">
            <div className="min-h-0 flex flex-col">
              <p className="sub-eyebrow">Tool calls</p>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 thin-scroll">
                {toolCalls.length === 0 && <Empty text="Agent tool calls appear here with their run time." />}
                {toolCalls.map((t) => {
                  const eng = t.tool === "analyze_lab_trend" ? (t.summary.includes("daytona") ? "daytona sandbox" : "local fallback") : "platform API";
                  const err = t.summary.startsWith("error") || t.summary.startsWith("unknown") || t.summary.startsWith("missing") || t.summary.startsWith("cannot");
                  return (
                    <div key={t.id} className="trace fade-in">
                      <div className="flex items-center justify-between">
                        <code className="text-[13px] font-semibold">{t.tool}</code>
                        <span className="text-[12px] tabular-nums text-ink-3">{t.ms} ms</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`engine engine-${eng.split(" ")[0] === "platform" ? "server" : eng.split(" ")[0]}`}>{eng}</span>
                        <code className="text-[12px] text-ink-2 truncate">{JSON.stringify(t.args ?? {}).replace(/[{}"]/g, "").slice(0, 60)}</code>
                      </div>
                      <p className={`text-[12.5px] mt-1 truncate ${err ? "text-red-700" : "text-ink-2"}`}>{t.summary}</p>
                    </div>
                  );
                })}
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
                {texts.length === 0 && <p className="text-center text-[12px] text-ink-3 pt-8 px-4">No texts today. Mom has not needed to call you.</p>}
                {[...texts].reverse().map((a) => {
                  const d = (a.detail ?? {}) as { urgency?: string; sms?: string };
                  return (
                    <div key={a.id} className="fade-in">
                      <div className={`sms ${d.urgency === "urgent" ? "sms-urgent" : ""}`}>
                        {d.urgency && d.urgency !== "fyi" && <span className="sms-tag">{d.urgency}</span>}
                        {a.summary}
                      </div>
                      <p className="text-[10.5px] text-ink-3 mt-1 ml-1">
                        {new Date(a.ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        {d.sms === "sent" ? " · delivered by SMS" : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="w-full mt-4 space-y-2 min-h-0 overflow-y-auto thin-scroll">
            <p className="sub-eyebrow">Written to the platform</p>
            {actions.length === 0 && <Empty text="Doses, readings, questions and refills cuida writes show here." />}
            {actions.map((a) => (
              <div key={a.id} className="action-card fade-in">
                <span className="check"><CheckIcon width={14} height={14} strokeWidth={2.4} /></span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">{({ refill_requested: "Refill sent", question_added: "Question saved for the doctor", dose_logged: "Dose logged", vital_logged: "Home reading saved" } as Record<string, string>)[a.kind]}</p>
                  <p className="text-[12.5px] text-ink-2 truncate">{a.summary}</p>
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

function RecordCard({ c, delay }: { c: Card; delay: number }) {
  const Icon = kindIcon[c.kind] ?? kindIcon.visit;
  const lab = c.lab ? record.labs[c.lab] : null;
  return (
    <div className="record-card rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-3">
        <span className={`kind kind-${c.kind}`}><Icon width={17} height={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-snug">{c.title}</p>
          <p className="text-[14px] text-ink-2 leading-snug">{c.subtitle}</p>
        </div>
      </div>
      {lab && <Spark series={lab.series as [string, number][]} trend={c.trend} unit={lab.unit} />}
      <p className="text-[11.5px] text-ink-3 mt-2">{c.source}</p>
    </div>
  );
}

function Spark({ series, trend, unit }: { series: [string, number][]; trend?: Trend; unit: string }) {
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
