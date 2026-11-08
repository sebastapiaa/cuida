import { agentRoute, query } from "@/lib/agent-route";
import { state } from "@/lib/platform";

export const dynamic = "force-dynamic";

export const GET = agentRoute("search_records", async (r) => query(r), async ({ q }) => {
  const { search } = await state().ready;
  const hits = search(q ?? "", 3);
  return {
    summary: hits.length ? hits.map((h) => h.passage.title).join(" · ") : "no match",
    data: {
      query: q,
      results: hits.map((h) => ({ document: h.passage.title, from: h.passage.source, date: h.passage.date ?? null, document_id: h.passage.docId, excerpt: h.passage.text })),
      note: hits.length ? undefined : "Nothing in Rosa's records matches. Say so honestly.",
    },
  };
});
