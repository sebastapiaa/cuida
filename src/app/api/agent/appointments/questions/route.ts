import { agentRoute, body } from "@/lib/agent-route";
import { emit, findAppt, spoken, state } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const POST = agentRoute("add_question_for_doctor", body, async ({ appointment, question }) => {
  if (!question) return { summary: "missing question", data: { error: "Need the question text." } };
  const a = findAppt(appointment ?? "next");
  if (!a) return { summary: "no upcoming appointment", data: { error: "No upcoming appointment found." } };
  const qs = (state().questions[a.id] ??= []);
  qs.push(question);
  emit({ kind: "question_added", summary: `${a.with}: ${question}`, detail: { appointment_id: a.id, question } });
  return { summary: `${a.with} +1 question`, data: { saved_to: `${a.type} with ${a.with}, ${spoken(a.date)} at ${a.time}`, questions_to_ask: qs } };
});
