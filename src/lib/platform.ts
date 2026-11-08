// cuida platform data layer.
// 1. Ingests the uploaded record PDFs in /records into a searchable passage index.
// 2. Holds the normalized patient record (meds, appointments, labs) plus everything
//    the agent writes back: doses taken, home vitals, questions for the doctor,
//    refill requests and messages to family.
// State lives in server memory for the demo (reset with DELETE /api/agent/feed).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import rosa from "@/data/rosa.json";

export const record = rosa;
export type Med = (typeof rosa.medications)[number];
export type Appt = (typeof rosa.appointments)[number];

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */
export type Doc = { id: string; file: string; title: string; source: string; date?: string; pages: string[] };
export type Passage = { docId: string; title: string; source: string; date?: string; text: string };

const RECORDS_DIR = path.join(process.cwd(), "records");
const NOISE = [/^SAMPLE RECORD/, /^Patient Rosa Delgado/, /^MRN BFM-/];

async function ingest(): Promise<{ docs: Doc[]; passages: Passage[] }> {
  const files = (await readdir(RECORDS_DIR)).filter((f) => f.endsWith(".pdf")).sort();
  const docs: Doc[] = [];
  const passages: Passage[] = [];
  for (const file of files) {
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path.join(RECORDS_DIR, file))));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((p) => p.split("\n").filter((l) => !NOISE.some((r) => r.test(l))).join("\n"));
    const lines = pages.join("\n").split("\n");
    const source = lines[0]?.split(" | ")[0] ?? "";
    const title = lines[1] ?? file;
    const date = file.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const id = file.replace(/\.pdf$/, "");
    docs.push({ id, file, title, source, date, pages });

    // ~650-char passages on line boundaries, each prefixed with its document title
    let buf: string[] = [];
    const flush = () => {
      if (buf.join(" ").trim().length > 30) passages.push({ docId: id, title, source, date, text: buf.join("\n") });
      buf = [];
    };
    for (const l of lines.slice(2)) {
      buf.push(l);
      if (buf.join(" ").length > 650) flush();
    }
    flush();
  }
  return { docs, passages };
}

/* ------------------------------------------------------------------ */
/* Search (BM25-style with plain-language + Spanish query expansion)   */
/* ------------------------------------------------------------------ */
const EXPAND: { [k: string]: string } = {
  pink: "eliquis apixaban pink oval", rosa: "eliquis apixaban pink", yellow: "lisinopril yellow", amarilla: "lisinopril yellow",
  blanca: "white metformin atorvastatin", white: "white metformin atorvastatin",
  heart: "cardiology cardiologist chen", corazon: "cardiology cardiologist chen heart", cardiologo: "cardiology chen",
  sugar: "a1c glucose diabetes", azucar: "a1c glucose diabetes", glucosa: "glucose a1c",
  pressure: "blood pressure lisinopril", presion: "blood pressure lisinopril",
  advil: "ibuprofen advil motrin nsaid eliquis bleeding", motrin: "ibuprofen advil", aleve: "naproxen aleve", ibuprofeno: "ibuprofen advil",
  tylenol: "tylenol acetaminophen", dolor: "pain tylenol", rodilla: "knee", knee: "knee physical therapy tylenol",
  blood: "blood", thinner: "eliquis apixaban bleeding", cholesterol: "ldl cholesterol atorvastatin", colesterol: "ldl cholesterol",
  kidney: "egfr creatinine kidney", rinon: "egfr kidney", eye: "eye navarro glasses", ojos: "eye navarro", lentes: "glasses",
  insurance: "insurance copay benefits", seguro: "insurance copay benefits", cost: "copay pay", cuesta: "copay pay",
  appointment: "appointment visit", cita: "appointment visit", refill: "refill prescription pharmacy", receta: "prescription refill",
  farmacia: "pharmacy harbor", allergy: "allergies penicillin sulfa", alergia: "allergies penicillin", shot: "vaccine flu",
  vacuna: "vaccine flu immunizations", fasting: "fasting no food midnight", ayuno: "fasting", comer: "food fasting",
};
const STOP = new Set(
  "the a an and or of to for is my me i do what when where how which with on at in it this that does did should can about am be de la el los las mi que cual cuando donde como para es un una y en por me puedo tomar".split(" ")
);
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.%/\s-]/g, " ");
const tok = (s: string) => norm(s).split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

function makeIndex(passages: Passage[]) {
  const docs = passages.map((p) => {
    const t = tok(p.title + " " + p.text);
    return { p, t, len: t.length, title: new Set(tok(p.title)) };
  });
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.len, 0) / N;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d.t)) df.set(t, (df.get(t) ?? 0) + 1);
  return (query: string, k = 3) => {
    const base = tok(query);
    const q = [...new Set([...base, ...base.flatMap((t) => tok(EXPAND[t] ?? ""))])];
    return docs
      .map((d) => {
        let s = 0;
        for (const t of q) {
          const n = df.get(t);
          if (!n) continue;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          const tf = d.t.filter((w) => w === t).length;
          if (tf) s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.len / avg))));
          if (d.title.has(t)) s += idf * 0.8;
        }
        return { passage: d.p, score: +s.toFixed(2) };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };
}

/* ------------------------------------------------------------------ */
/* Mutable state the agent writes to                                   */
/* ------------------------------------------------------------------ */
export type FeedEvent = {
  id: string;
  ts: number;
  kind: "tool_call" | "dose_logged" | "vital_logged" | "question_added" | "refill_requested" | "family_message";
  tool?: string;
  args?: unknown;
  ms?: number;
  summary: string;
  detail?: unknown;
};

type State = {
  ready: Promise<{ docs: Doc[]; passages: Passage[]; search: ReturnType<typeof makeIndex> }>;
  doses: { medication: string; medId: string; time_of_day: string; date: string; ts: number }[];
  vitals: { type: string; value: string; unit: string; ts: number; note?: string; flag: string }[];
  questions: { [apptId: string]: string[] };
  refills: { medId: string; ts: number }[];
  feed: FeedEvent[];
};

const g = globalThis as unknown as { __cuida?: State };

export function state(): State {
  if (!g.__cuida) {
    g.__cuida = {
      ready: ingest().then((d) => ({ ...d, search: makeIndex(d.passages) })),
      doses: [],
      vitals: [],
      questions: {},
      refills: [],
      feed: [],
    };
  }
  return g.__cuida;
}

export function resetState() {
  const s = state();
  s.doses = [];
  s.vitals = [];
  s.questions = {};
  s.refills = [];
  s.feed = [];
}

export function emit(e: Omit<FeedEvent, "id" | "ts">) {
  const ev = { ...e, id: crypto.randomUUID(), ts: Date.now() };
  state().feed.unshift(ev);
  state().feed.splice(200);
  return ev;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
export const TZ = "America/Los_Angeles";
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function nowText() {
  return new Date().toLocaleString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
export const spoken = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

export function runsOut(m: Med) {
  if (!m.lastFilled) return null;
  const d = new Date(m.lastFilled + "T12:00:00");
  d.setDate(d.getDate() + m.daysSupply);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) / 86400000);
}

export function findMed(q: string): Med | undefined {
  const n = norm(q);
  const words = tok(q).flatMap((t) => [t, ...tok(EXPAND[t] ?? "")]);
  return (
    rosa.medications.find((m) => n.includes(m.id) || norm(m.name).split(/\W+/).some((w) => w.length > 3 && n.includes(w))) ??
    rosa.medications.find((m) => words.some((w) => norm(`${m.name} ${m.appearance} ${m.purpose}`).includes(w)))
  );
}

export function findAppt(q: string): Appt | undefined {
  const today = todayISO();
  const upcoming = rosa.appointments.filter((a) => a.date >= today);
  if (!q || /next|proxim/i.test(q)) return upcoming[0];
  const words = tok(q).flatMap((t) => [t, ...tok(EXPAND[t] ?? "")]);
  let best: Appt | undefined, bestScore = 0;
  for (const a of upcoming) {
    const hay = norm(`${a.with} ${a.type} ${a.where}`);
    const s = words.filter((w) => hay.includes(w)).length;
    if (s > bestScore) (best = a), (bestScore = s);
  }
  return best ?? upcoming[0];
}
