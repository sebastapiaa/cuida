import { agentRoute, query } from "@/lib/agent-route";
import { state } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const GET = agentRoute("read_document", async (r) => query(r), async ({ id }) => {
  const { docs } = await state().ready;
  if (!id) {
    return { summary: `${docs.length} documents`, data: { documents: docs.map((d) => ({ document_id: d.id, title: d.title, from: d.source, date: d.date ?? null })) } };
  }
  const n = id.toLowerCase();
  const doc = docs.find((d) => d.id === id) ?? docs.find((d) => d.id.includes(n) || d.title.toLowerCase().includes(n));
  if (!doc) return { summary: `not found: ${id}`, data: { error: "No such document", available: docs.map((d) => d.id) } };
  return { summary: doc.title, data: { document_id: doc.id, title: doc.title, from: doc.source, date: doc.date ?? null, text: doc.pages.join("\n") } };
});
