import rosa from "@/data/rosa.json";

export type Record = typeof rosa;
export const record = rosa;

export type ChunkKind =
  | "medication"
  | "appointment"
  | "visit"
  | "lab"
  | "condition"
  | "allergy"
  | "care_team"
  | "insurance"
  | "vaccine"
  | "family";

export type Chunk = {
  id: string;
  kind: ChunkKind;
  title: string;
  subtitle: string;
  text: string;
  source: string;
  date?: string;
  keywords: string;
};

const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const prettyDate = fmtDate;

// Plain-language and Spanish synonyms so "the pink pill", "la pastilla rosa",
// "my heart doctor" or "el azúcar" all land on the right record.
const EXTRA: Record_<string> = {
  apixaban: "pink pill rosa pastilla blood thinner anticoagulante sangre stroke derrame heart corazon afib eliquis",
  metformin: "white pill blanca pastilla sugar azucar diabetes glucosa",
  lisinopril: "yellow pill amarilla pastilla pressure presion",
  atorvastatin: "white small pill blanca colesterol cholesterol night noche bedtime",
  "vitamin-d": "vitamin vitamina bones huesos",
  acetaminophen: "tylenol pain dolor knee rodilla advil motrin aleve ibuprofen ibuprofeno",
  "appt-chen": "heart doctor cardiologo corazon cita appointment next proxima thursday jueves",
  "appt-lab": "blood draw sangre analisis laboratorio fasting ayuno cita appointment",
  "appt-ruiz": "doctor ruiz cita appointment diabetes azucar",
  "appt-navarro": "eye ojos vista glasses lentes cita appointment",
  "visit-2026-08-05": "advil motrin aleve ibuprofen ibuprofeno naproxen pain dolor knee rodilla bleeding sangrado heart corazon chen",
  "visit-2026-09-22": "flu shot vacuna knee rodilla walk caminar a1c sugar azucar physical therapy terapia",
  "visit-2026-03-10": "pressure presion lisinopril dose dosis changed cambio",
  "visit-2025-12-02": "eye ojos glasses lentes",
};
type Record_<T> = { [k: string]: T };

export function buildChunks(r: Record = rosa): Chunk[] {
  const chunks: Chunk[] = [];

  for (const m of r.medications) {
    chunks.push({
      id: m.id,
      kind: "medication",
      title: `${m.name} ${m.dose}`,
      subtitle: `${m.appearance} · ${m.schedule.join(" + ")}`,
      text: `${m.name} ${m.dose}. Purpose: ${m.purpose} How to take: ${m.howToTake} Looks like: ${m.appearance}. Prescribed by ${m.prescriber}.${
        m.lastFilled ? ` Last filled ${m.lastFilled}, ${m.daysSupply}-day supply, ${m.refillsLeft} refills left.` : ""
      } ${m.notes}`.trim(),
      source: `Medication list · ${m.prescriber}`,
      keywords: `${m.id} ${m.purpose} ${m.appearance} ${EXTRA[m.id] ?? ""}`,
    });
  }

  for (const a of r.appointments) {
    chunks.push({
      id: a.id,
      kind: "appointment",
      title: a.type,
      subtitle: `${fmtDate(a.date)} · ${a.time}`,
      text: `${a.type} with ${a.with} on ${fmtDate(a.date)} at ${a.time}. Location: ${a.where}. How to prepare: ${a.prep}`,
      source: `Appointments · ${a.with}`,
      date: a.date,
      keywords: `${a.with} ${a.type} ${EXTRA[a.id] ?? ""}`,
    });
  }

  for (const v of r.visits) {
    chunks.push({
      id: v.id,
      kind: "visit",
      title: `Visit with ${v.with}`,
      subtitle: fmtDate(v.date),
      text: `Visit summary from ${v.with} on ${fmtDate(v.date)}: ${v.summary}`,
      source: `After-visit summary · ${v.with} · ${v.date}`,
      date: v.date,
      keywords: `${v.with} ${EXTRA[v.id] ?? ""}`,
    });
  }

  for (const [key, lab] of Object.entries(r.labs)) {
    const last = lab.series[lab.series.length - 1];
    chunks.push({
      id: `lab-${key}`,
      kind: "lab",
      title: lab.label,
      subtitle: `Latest ${last[1]} ${lab.unit} · ${last[0]}`,
      text: `${lab.label}: ${lab.series.map(([d, v]) => `${v} ${lab.unit} on ${d}`).join("; ")}. Goal: ${lab.goal}.`,
      source: `Lab results · ${key}`,
      date: String(last[0]),
      keywords: `${key} lab results resultados analisis ${key === "a1c" ? "sugar azucar glucosa diabetes" : ""} ${
        key === "ldl" ? "colesterol cholesterol" : ""
      } ${key === "blood_pressure" ? "pressure presion" : ""} ${key === "egfr" ? "kidney rinon rinones" : ""} ${
        key === "weight" ? "peso" : ""
      }`,
    });
  }

  for (const c of r.conditions) {
    chunks.push({
      id: `cond-${c.name.split(" ")[0].toLowerCase().replace(/\W/g, "")}`,
      kind: "condition",
      title: c.name,
      subtitle: `Since ${c.since}`,
      text: `${c.name} (since ${c.since}). ${c.plain}`,
      source: "Problem list",
      keywords: "condition diagnosis diagnostico enfermedad " + c.plain,
    });
  }

  chunks.push({
    id: "allergies",
    kind: "allergy",
    title: "Allergies",
    subtitle: r.allergies.map((a) => a.substance).join(", "),
    text: `Allergies: ${r.allergies.map((a) => `${a.substance} (${a.reaction})`).join("; ")}.`,
    source: "Allergy list",
    keywords: "allergy allergic alergia alergica antibiotic antibiotico penicilina",
  });

  for (const t of r.careTeam) {
    chunks.push({
      id: `team-${t.name.replace(/\W+/g, "-").toLowerCase()}`,
      kind: "care_team",
      title: t.name,
      subtitle: t.role,
      text: `${t.name}, ${t.role}, ${t.clinic}. Address: ${t.address}. Phone: ${t.phone}.${"hours" in t && t.hours ? ` Hours: ${t.hours}.` : ""}`,
      source: "Care team",
      keywords: `doctor doctora phone telefono number numero address direccion ${t.role}`,
    });
  }

  chunks.push({
    id: "insurance",
    kind: "insurance",
    title: r.insurance.plan,
    subtitle: `Member ID ${r.insurance.memberId}`,
    text: `Insurance: ${r.insurance.plan}. Member ID ${r.insurance.memberId}. ${r.insurance.copays} Plan phone ${r.insurance.phone}.`,
    source: "Insurance card",
    keywords: "insurance seguro medicare copay cost costo pay pagar card tarjeta",
  });

  chunks.push({
    id: "vaccines",
    kind: "vaccine",
    title: "Vaccines",
    subtitle: `Latest: ${r.vaccines[0].name}`,
    text: `Vaccines: ${r.vaccines.map((v) => `${v.name} on ${v.date}`).join("; ")}.`,
    source: "Immunization record",
    keywords: "vaccine vacuna shot inyeccion flu gripe covid shingles",
  });

  chunks.push({
    id: "family",
    kind: "family",
    title: "Family contacts",
    subtitle: r.patient.family.map((f) => f.name).join(", "),
    text: `Family: ${r.patient.family.map((f) => `${f.name} (${f.relation}, ${f.phone})`).join("; ")}.`,
    source: "Emergency contacts",
    keywords: "family familia daughter hija son hijo ana miguel contact",
  });

  return chunks;
}

const STOP = new Set(
  "the a an and or of to for is my me i do what when where how which with on at in it this that does did should can about de la el los las mi que cual cuando donde como para es un una y en por".split(
    " "
  )
);

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.\s-]/g, " ");

const tokens = (s: string) => norm(s).split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

export type Hit = { chunk: Chunk; score: number };

export function createIndex(chunks: Chunk[]) {
  const docs = chunks.map((c) => ({
    chunk: c,
    title: new Set(tokens(c.title)),
    kw: new Set(tokens(c.keywords)),
    body: tokens(c.text),
  }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set([...d.title, ...d.kw, ...d.body])) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;

  function search(query: string, k = 3): Hit[] {
    const q = tokens(query);
    if (!q.length) return [];
    const hits = docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const idf = Math.log(1 + N / (1 + (df.get(t) ?? 0)));
        const prefix = (set: Iterable<string>) => [...set].some((w) => w.length > 3 && t.length > 3 && (w.startsWith(t) || t.startsWith(w)));
        if (d.title.has(t)) score += 3 * idf;
        else if (prefix(d.title)) score += 1.5 * idf;
        if (d.kw.has(t)) score += 2.5 * idf;
        else if (prefix(d.kw)) score += 1.2 * idf;
        const tf = d.body.filter((w) => w === t).length;
        if (tf) score += (1 + Math.log(tf)) * idf;
      }
      return { chunk: d.chunk, score };
    });
    return hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }

  return { search, size: N };
}
