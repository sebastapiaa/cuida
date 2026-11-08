"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { prettyDate, record } from "@/lib/records";
import type { FeedEvent } from "@/lib/platform";
import { PillIcon, CalendarIcon, FlaskIcon, UserIcon, MicIcon, CheckIcon, AlertIcon, NoteIcon } from "./icons";

/* ------------------------------------------------------------------ */
/* Rosa's phone. Everything shown comes from the platform:             */
/* GET /api/agent/feed = every tool call the agent made + every write. */
/* ------------------------------------------------------------------ */
type LabKey = keyof typeof record.labs;
type Med = (typeof record.medications)[number];
type Line = { role: "user" | "agent"; text: string; id: number };
type Trend = { first: { date: string; value: number }; latest: { date: string; value: number }; direction: string; at_goal: boolean; unit: string };
type Card = { id: string; kind: "medication" | "appointment" | "lab" | "document"; title: string; subtitle: string; source: string; lab?: LabKey; trend?: Trend; at: number };
type Feed = {
  feed: FeedEvent[];
  doses: { medication: string; medId: string; time_of_day: string; date: string; ts: number }[];
  vitals: { type: string; value: string; unit: string; ts: number; flag: string }[];
  questions: { [apptId: string]: string[] };
  refills: { medId: string; ts: number }[];
  index: { documents: number; passages: number };
};
type Tab = "talk" | "pills" | "visits" | "health" | "ana";
const EMPTY: Feed = { feed: [], doses: [], vitals: [], questions: {}, refills: [], index: { documents: 0, passages: 0 } };

const today = () => new Date();
const isoToday = () => today().toISOString().slice(0, 10);
const runsOut = (m: Med) => {
  if (!m.lastFilled) return null;
  const d = new Date(m.lastFilled + "T12:00:00");
  d.setDate(d.getDate() + m.daysSupply);
  return d;
};
const daysUntil = (d: Date) => Math.ceil((d.getTime() - today().getTime()) / 86400000);
const shortDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const time = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const medCard = (m: Med, at: number): Card => ({ id: m.id, kind: "medication", title: `${m.name} ${m.dose}`, subtitle: `${m.purpose}`, source: m.appearance, at });
const apptCard = (a: (typeof record.appointments)[number], at: number): Card => ({ id: a.id, kind: "appointment", title: a.type, subtitle: `${prettyDate(a.date)} · ${a.time}`, source: a.with, at });
const labCard = (key: LabKey, at: number, trend?: Trend): Card => {
  const lab = record.labs[key];
  const last = lab.series[lab.series.length - 1];
  return { id: `lab-${key}`, kind: "lab", title: lab.label, subtitle: `Latest ${last[1]} ${lab.unit} · goal ${lab.goal}`, source: `Lab results · ${last[0]}`, lab: key, trend, at };
};
const findMeds = (q: string, timeOfDay?: string): Med[] => {
  const n = (q || "").toLowerCase();
  if (/all|todas|everything/.test(n)) return record.medications.filter((m) => !timeOfDay || m.schedule.includes(timeOfDay));
  return record.medications.filter((m) => n.includes(m.id) || m.name.toLowerCase().split(/\W+/).some((w) => w.length > 3 && n.includes(w)) || m.appearance.toLowerCase().split(" ").some((w) => w.length > 3 && n.includes(w)));
};

// What the agent pulled up, for the Talk tab
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
      const up = record.appointments.filter((x) => x.date >= isoToday());
      return (a.range === "next" ? up.slice(0, 1) : up).map((x) => apptCard(x, at));
    }
    case "add_question_for_doctor": {
      const saved = String(d.saved_to ?? "");
      return [apptCard(record.appointments.find((x) => saved.includes(x.with)) ?? record.appointments[0], at)];
    }
    case "analyze_lab_trend":
      return a.test && record.labs[a.test as LabKey] ? [labCard(a.test as LabKey, at, d.first ? (d as unknown as Trend) : undefined)] : [];
    case "log_home_reading":
      return [{ id: `vital-${at}`, kind: "lab", title: `${String(a.type ?? "").replace("_", " ")} ${a.value}`, subtitle: String(d.guidance ?? "").slice(0, 90), source: `Saved · ${String(d.flag ?? "").replace("_", " ")}`, at }];
    case "search_records": {
      const results = (d.results as { document: string; from: string; date: string | null; excerpt: string }[] | undefined) ?? [];
      return results.slice(0, 2).map((r, i) => ({ id: `doc-${at}-${i}`, kind: "document", title: r.document, subtitle: r.excerpt.replace(/\s+/g, " ").slice(0, 120) + (r.excerpt.length > 120 ? "…" : ""), source: `${r.from}${r.date ? " · " + r.date : ""}`, at }));
    }
    case "read_document":
      return d.title ? [{ id: `doc-${at}`, kind: "document", title: String(d.title), subtitle: String(d.from ?? ""), source: d.date ? `Document · ${d.date}` : "Document", at }] : [];
    default:
      return [];
  }
}
const TOOL_LABEL: Record<string, string> = {
  get_daily_briefing: "Checked today's plan", search_records: "Searched your records", read_document: "Read a document", get_medications: "Checked your pharmacy list",
  log_dose: "Logged your dose", get_appointments: "Checked your appointments", add_question_for_doctor: "Saved a question for the doctor", analyze_lab_trend: "Analyzed your lab trend",
  log_home_reading: "Saved your reading", request_refill: "Sent a refill request", notify_family: "Texted Ana",
};

/* ------------------------------------------------------------------ */
export default function Stage() {
  const [tab, setTab] = useState<Tab>("talk");
  const [data, setData] = useState<Feed>(EMPTY);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const lineId = useRef(0);

  const conversation = useConversation({
    onConnect: () => setError(null),
    onError: (m: string) => setError(String(m)),
    onMessage: (m) => {
      const role: Line["role"] = m.role === "user" || m.source === "user" ? "user" : "agent";
      setLines((p) => [...p, { role, text: m.message, id: ++lineId.current }].slice(-30));
    },
  });
  const { status, isSpeaking } = conversation;
  const connected = status === "connected";

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

  const start = async () => {
    setError(null);
    setTab("talk");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { token } = await fetch("/api/token").then((r) => r.json()).catch(() => ({ token: null }));
      const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
      if (!token && !agentId) return setError("Agent not configured. Run npm run up.");
      conversation.startSession(token ? { conversationToken: token, connectionType: "webrtc" as const } : { agentId: agentId!, connectionType: "webrtc" as const });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const reset = async () => {
    await fetch("/api/agent/feed", { method: "DELETE" });
    setLines([]);
    refresh();
  };

  /* orb volume */
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

  /* derived from the platform */
  const toolCalls = useMemo(() => data.feed.filter((e) => e.kind === "tool_call"), [data.feed]);
  const texts = useMemo(() => data.feed.filter((e) => e.kind === "family_message"), [data.feed]);
  const writes = useMemo(() => data.feed.filter((e) => ["refill_requested", "question_added", "dose_logged", "vital_logged"].includes(e.kind)), [data.feed]);
  const surfaced = useMemo(() => {
    for (const e of toolCalls) {
      const cards = cardsFor(e);
      if (cards.length) return cards.slice(0, 3);
    }
    return [];
  }, [toolCalls]);
  const latest = toolCalls[0];
  const lastAgent = [...lines].reverse().find((l) => l.role === "agent");
  const lastUser = [...lines].reverse().find((l) => l.role === "user");
  const takenToday = data.doses.filter((d) => d.date === isoToday());
  const hour = today().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const unread = texts.length;

  return (
    <div className="h-screen w-screen bg-white flex flex-col">
      <div className="px-8 pt-6">
        <span className="text-[26px] font-semibold tracking-[-0.03em] text-navy">cuida.</span>
      </div>
      <div className="flex-1 grid place-items-center pb-6 -mt-6">
        <div className="phone">
          <div className="phone-notch" />
          <div className="phone-screen">
            <div className="statusbar"><span>{today().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span><span className="flex items-center gap-1.5"><span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green" : "bg-ink-3/40"}`} />{connected ? "live" : ""}</span></div>

            {/* ---------------- content ---------------- */}
            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-3 pb-4">
              {tab === "talk" && (
                <div className="flex flex-col min-h-full">
                  <p className="eyebrow">{today().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
                  <h2 className="text-[32px] font-semibold leading-[1.05] tracking-[-0.03em] mt-1">{greeting},<br />Rosa</h2>

                  <div className="flex flex-col items-center mt-7">
                    <button onClick={connected ? () => conversation.endSession() : start} className="orb-btn" aria-label={connected ? "End" : "Talk to cuida"}>
                      <div ref={orbRef} className={`orb ${connected ? (isSpeaking ? "orb-speaking" : "orb-listening") : ""}`}>
                        {!connected && <MicIcon width={44} height={44} strokeWidth={1.6} />}
                      </div>
                    </button>
                    <p className="mt-6 text-[15px] font-medium text-ink-2">
                      {status === "connecting" ? "Connecting…" : !connected ? "Tap to talk" : isSpeaking ? "cuida is speaking" : "Listening…"}
                    </p>
                  </div>

                  <div className="mt-5 space-y-3">
                    {lastUser && <p className="text-[14px] text-ink-3 italic">“{lastUser.text}”</p>}
                    {lastAgent && <p key={lastAgent.id} className="caption fade-in">{lastAgent.text}</p>}
                    {latest && connected && (
                      <p className="text-[12px] text-ink-3 flex items-center gap-1.5 fade-in" key={latest.id}>
                        <CheckIcon width={12} height={12} strokeWidth={2.6} className="text-green" />
                        {TOOL_LABEL[latest.tool ?? ""] ?? latest.tool} · {latest.ms} ms
                      </p>
                    )}
                    {surfaced.length > 0 && (
                      <div className="pt-1 space-y-2">
                        <p className="eyebrow">From your records</p>
                        {surfaced.map((c, i) => <RecordCard key={c.id + c.at} c={c} delay={i * 70} />)}
                      </div>
                    )}
                  </div>

                  {connected && (
                    <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { conversation.sendUserMessage(typed.trim()); setTyped(""); } }} className="mt-auto pt-4">
                      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead of talking…" className="type-box" />
                    </form>
                  )}
                  {error && <p className="mt-3 text-[12.5px] text-[var(--red)] bg-[var(--red-soft)] rounded-xl px-3 py-2">{error}</p>}
                </div>
              )}

              {tab === "pills" && (
                <div>
                  <Header title="Pills" sub="From your pharmacy list" />
                  {(["morning", "evening", "bedtime", "as needed"] as const).map((slot) => {
                    const meds = record.medications.filter((m) => m.schedule.includes(slot));
                    if (!meds.length) return null;
                    return (
                      <div key={slot} className="mt-4">
                        <p className="eyebrow mb-2 capitalize">{slot}</p>
                        <div className="space-y-2">
                          {meds.map((m) => {
                            const done = takenToday.some((d) => d.medId === m.id && d.time_of_day === slot);
                            const out = runsOut(m);
                            const days = out ? daysUntil(out) : null;
                            const requested = data.refills.some((r) => r.medId === m.id);
                            const low = out && m.refillsLeft === 0 && days !== null && days <= 10;
                            return (
                              <div key={m.id + slot} className="card flex items-start gap-3">
                                <span className={`pill-swatch pill-${m.id} mt-1.5`} />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[15px] font-semibold leading-tight">{m.name.split(" (")[0]} <span className="text-ink-3 font-medium">{m.dose}</span></p>
                                  <p className="text-[13px] text-ink-2 mt-0.5">{m.purpose}</p>
                                  {(low || requested) && (
                                    <p className="mt-1.5">
                                      {requested ? <span className="tag tag-green"><CheckIcon width={11} height={11} strokeWidth={2.6} />Refill requested</span>
                                        : <span className="tag tag-red"><AlertIcon width={11} height={11} />Runs out {out!.toLocaleDateString("en-US", { weekday: "long" })} · 0 refills</span>}
                                    </p>
                                  )}
                                </div>
                                {slot !== "as needed" && (
                                  <span className={`w-7 h-7 rounded-full grid place-items-center flex-none ${done ? "bg-green text-white" : "border border-[var(--line)] text-transparent"}`}>
                                    <CheckIcon width={14} height={14} strokeWidth={2.8} />
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === "visits" && (
                <div>
                  <Header title="Visits" sub="Upcoming appointments" />
                  <div className="space-y-2 mt-3">
                    {record.appointments.filter((a) => a.date >= isoToday()).map((a, i) => {
                      const qs = data.questions[a.id] ?? [];
                      return (
                        <div key={a.id} className={i === 0 ? "card-soft" : "card"}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[15px] font-semibold leading-tight">{a.with}</p>
                              <p className="text-[13px] text-ink-2 mt-0.5">{a.type}</p>
                            </div>
                            <div className="text-right flex-none">
                              <p className="text-[13px] font-semibold">{shortDate(a.date)}</p>
                              <p className="text-[12.5px] text-ink-2">{a.time}</p>
                            </div>
                          </div>
                          <p className="text-[12.5px] text-ink-3 mt-2">{a.where}</p>
                          {i === 0 && <p className="text-[13px] text-ink-2 mt-2">{a.prep}</p>}
                          {qs.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-[var(--line)]">
                              <p className="eyebrow mb-1.5">Questions to ask</p>
                              {qs.map((q, j) => <p key={j} className="text-[13.5px] flex gap-2 fade-in"><span className="text-green font-bold">·</span>{q}</p>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="eyebrow mt-6 mb-2">Past visits</p>
                  <div className="space-y-2">
                    {record.visits.map((v) => (
                      <div key={v.id} className="card">
                        <div className="flex justify-between gap-3">
                          <p className="text-[14px] font-semibold">{v.with}</p>
                          <p className="text-[12.5px] text-ink-3 flex-none">{shortDate(v.date)}</p>
                        </div>
                        <p className="text-[13px] text-ink-2 mt-1 leading-snug">{v.summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "health" && (
                <div>
                  <Header title="Health" sub="Lab results and home readings" />
                  <div className="space-y-2 mt-3">
                    {(Object.keys(record.labs) as LabKey[]).map((key) => {
                      const lab = record.labs[key];
                      const last = lab.series[lab.series.length - 1];
                      const trendEvent = toolCalls.find((e) => e.tool === "analyze_lab_trend" && (e.args as { test?: string })?.test === key && (e.detail as { first?: unknown })?.first);
                      const trend = trendEvent?.detail as Trend | undefined;
                      return (
                        <div key={key} className="card">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[15px] font-semibold leading-tight">{lab.label}</p>
                              <p className="text-[12.5px] text-ink-3 mt-0.5">Goal {lab.goal}</p>
                            </div>
                            <div className="text-right flex-none">
                              <p className="text-[18px] font-semibold leading-none">{last[1]} <span className="text-[12px] text-ink-3 font-medium">{lab.unit}</span></p>
                              {trend && <span className={`tag mt-1.5 ${trend.at_goal ? "tag-green" : "tag-navy"}`}>{trend.direction}{trend.at_goal ? " · at goal" : ""}</span>}
                            </div>
                          </div>
                          <Spark series={lab.series as [string, number][]} />
                        </div>
                      );
                    })}
                  </div>
                  <p className="eyebrow mt-6 mb-2">Home readings</p>
                  {data.vitals.length === 0 && <p className="text-[13px] text-ink-3">None yet. Tell cuida a reading, like “my blood pressure is 142 over 88”.</p>}
                  <div className="space-y-2">
                    {[...data.vitals].reverse().map((v) => (
                      <div key={v.ts} className="card flex items-center justify-between gap-3 fade-in">
                        <div>
                          <p className="text-[14.5px] font-semibold capitalize">{v.type.replace("_", " ")}</p>
                          <p className="text-[12.5px] text-ink-3">{time(v.ts)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[17px] font-semibold leading-none">{v.value} <span className="text-[12px] text-ink-3 font-medium">{v.unit}</span></p>
                          <span className={`tag mt-1.5 ${v.flag === "ok" ? "tag-green" : v.flag.startsWith("urgent") ? "tag-red" : "tag-navy"}`}>{v.flag.replace("_", " ")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "ana" && (
                <div>
                  <Header title="Ana" sub="Your daughter · 30 minutes away" />
                  <div className="mt-3 space-y-2.5">
                    {texts.length === 0 && <p className="text-[13px] text-ink-3">No texts today. Ana has not needed a call.</p>}
                    {[...texts].reverse().map((a) => {
                      const d = (a.detail ?? {}) as { urgency?: string; sms?: string };
                      return (
                        <div key={a.id} className="fade-in">
                          <div className={`sms ${d.urgency === "urgent" ? "sms-urgent" : ""}`}>{a.summary}</div>
                          <p className="text-[11px] text-ink-3 mt-1 ml-1">{time(a.ts)}{d.urgency && d.urgency !== "fyi" ? ` · ${d.urgency}` : ""}{d.sms === "sent" ? " · delivered by SMS" : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="eyebrow mt-6 mb-2">Updated in your record</p>
                  {writes.length === 0 && <p className="text-[13px] text-ink-3">Doses, readings, questions and refills cuida saves show here.</p>}
                  <div className="space-y-2">
                    {writes.map((w) => (
                      <div key={w.id} className="card flex items-start gap-3 fade-in">
                        <span className="w-6 h-6 rounded-full bg-green text-white grid place-items-center flex-none mt-0.5"><CheckIcon width={13} height={13} strokeWidth={2.8} /></span>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold">{({ refill_requested: "Refill sent", question_added: "Question saved", dose_logged: "Dose logged", vital_logged: "Reading saved" } as Record<string, string>)[w.kind]}</p>
                          <p className="text-[12.5px] text-ink-2 truncate">{w.summary}</p>
                          <p className="text-[11px] text-ink-3 mt-0.5">{time(w.ts)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={reset} className="mt-6 text-[12px] text-ink-3 hover:text-navy">Reset demo</button>
                </div>
              )}
            </div>

            {/* ---------------- tab bar ---------------- */}
            <nav className="tabbar">
              <TabBtn on={tab === "talk"} onClick={() => setTab("talk")} label="Talk"><MicIcon width={20} height={20} /></TabBtn>
              <TabBtn on={tab === "pills"} onClick={() => setTab("pills")} label="Pills"><PillIcon width={20} height={20} /></TabBtn>
              <TabBtn on={tab === "visits"} onClick={() => setTab("visits")} label="Visits"><CalendarIcon width={20} height={20} /></TabBtn>
              <TabBtn on={tab === "health"} onClick={() => setTab("health")} label="Health"><FlaskIcon width={20} height={20} /></TabBtn>
              <TabBtn on={tab === "ana"} onClick={() => setTab("ana")} label="Ana" badge={unread}><UserIcon width={20} height={20} /></TabBtn>
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[28px] font-semibold tracking-[-0.03em] leading-none">{title}</h2>
      <p className="text-[13px] text-ink-3 mt-1.5">{sub}</p>
    </div>
  );
}

function TabBtn({ on, onClick, label, badge, children }: { on: boolean; onClick: () => void; label: string; badge?: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`tab ${on ? "tab-on" : ""}`}>
      <span className="relative">
        {children}
        {badge ? <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-green text-white text-[10px] font-bold grid place-items-center">{badge}</span> : null}
      </span>
      {label}
    </button>
  );
}

function RecordCard({ c, delay }: { c: Card; delay: number }) {
  const Icon = { medication: PillIcon, appointment: CalendarIcon, lab: FlaskIcon, document: NoteIcon }[c.kind];
  const lab = c.lab ? record.labs[c.lab] : null;
  return (
    <div className="card rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-full bg-navy-soft text-navy-2 grid place-items-center flex-none"><Icon width={16} height={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug">{c.title}</p>
          <p className="text-[13px] text-ink-2 leading-snug mt-0.5">{c.subtitle}</p>
        </div>
      </div>
      {lab && <Spark series={lab.series as [string, number][]} trend={c.trend} unit={lab.unit} />}
      <p className="text-[11.5px] text-ink-3 mt-2">{c.source}</p>
    </div>
  );
}

function Spark({ series, trend, unit }: { series: [string, number][]; trend?: Trend; unit?: string }) {
  const w = 300, h = 44, pad = 6;
  const vs = series.map((p) => p[1]);
  const min = Math.min(...vs), max = Math.max(...vs);
  const pts = series.map((p, i) => [pad + (i * (w - 2 * pad)) / (series.length - 1), h - pad - ((p[1] - min) / (max - min || 1)) * (h - 2 * pad)]);
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[44px]">
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--navy-2)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 3} fill={i === pts.length - 1 ? "var(--green)" : "white"} stroke={i === pts.length - 1 ? "var(--green)" : "var(--navy-2)"} strokeWidth="2" />)}
      </svg>
      {trend && (
        <p className="text-[13px] text-ink-2">
          {trend.first.value} → <b className="text-navy">{trend.latest.value} {unit}</b> · {trend.direction}{trend.at_goal ? " · at goal" : ""}
        </p>
      )}
    </div>
  );
}
