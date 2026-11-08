import { agentRoute, body } from "@/lib/agent-route";
import { emit, record, state } from "@/lib/platform";

export const dynamic = "force-dynamic";

const UNITS: { [k: string]: string } = { blood_pressure: "mmHg", blood_sugar: "mg/dL", weight: "lb", heart_rate: "bpm" };

function assess(type: string, value: string): { flag: string; guidance: string } {
  if (type === "blood_pressure") {
    const [sys, dia] = value.split(/[^\d]+/).map(Number);
    if (!sys || !dia) return { flag: "unreadable", guidance: "Ask Rosa to repeat both numbers, top and bottom." };
    if (sys >= 180 || dia >= 120) return { flag: "urgent", guidance: "Very high. If she has chest pain, headache, vision changes, weakness or trouble speaking: call 911 now. Otherwise rest 5 minutes, recheck, and call Dr. Ruiz today. Notify Ana as urgent." };
    if (sys < 90) return { flag: "low", guidance: "Low. Sit or lie down, drink water, recheck. Call Dr. Ruiz if dizzy." };
    if (sys >= 140 || dia >= 90) return { flag: "above_goal", guidance: "Above her goal of under 130. Recheck later today; mention it to Dr. Chen on Thursday." };
    return { flag: "ok", guidance: "Within her goal." };
  }
  if (type === "blood_sugar") {
    const v = Number(value.replace(/[^\d.]/g, ""));
    if (v < 70) return { flag: "urgent_low", guidance: "Low blood sugar. Eat or drink 15 grams of fast sugar (half cup of juice), recheck in 15 minutes. Notify Ana." };
    if (v > 300) return { flag: "urgent_high", guidance: "Very high. Call Dr. Ruiz today. If confused or vomiting, call 911. Notify Ana." };
    if (v > 180) return { flag: "above_goal", guidance: "Higher than usual. Note what she ate; recheck before the next meal." };
    return { flag: "ok", guidance: "Within a normal range for her." };
  }
  if (type === "heart_rate") {
    const v = Number(value.replace(/[^\d.]/g, ""));
    if (v > 120 || v < 50) return { flag: "urgent", guidance: "Outside safe range for her AFib. If dizzy, short of breath or chest pain, call 911. Otherwise call Dr. Chen today. Notify Ana." };
    return { flag: "ok", guidance: "Within range." };
  }
  if (type === "weight") {
    const v = Number(value.replace(/[^\d.]/g, ""));
    const last = record.labs.weight.series.at(-1)![1] as number;
    return { flag: Math.abs(v - last) >= 5 ? "changed" : "ok", guidance: `Last clinic weight was ${last} lb.` };
  }
  return { flag: "ok", guidance: "" };
}

export const POST = agentRoute("log_home_reading", body, async ({ type, value, note }) => {
  if (!type || !value) return { summary: "missing type or value", data: { error: `Need both type (one of ${Object.keys(UNITS).join(", ")}) and value.` } };
  value = String(value);
  const unit = UNITS[type] ?? "";
  const { flag, guidance } = assess(type, value);
  state().vitals.push({ type, value, unit, ts: Date.now(), note, flag });
  emit({ kind: "vital_logged", summary: `${type.replace("_", " ")} ${value} ${unit} · ${flag}`, detail: { type, value, unit, flag } });
  const clinic = type === "blood_pressure" ? record.labs.blood_pressure.series.at(-1) : type === "weight" ? record.labs.weight.series.at(-1) : null;
  return { summary: `${type} ${value} · ${flag}`, data: { saved: true, type, value, unit, flag, guidance, last_clinic_reading: clinic ? { date: clinic[0], value: clinic[1] } : undefined } };
});
