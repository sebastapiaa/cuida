// Runs once when the Next.js server starts (before it accepts requests).
// Ingests the record PDFs so the first search_records / read_document call is instant,
// and starts warming the Daytona sandbox in the background.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const t = Date.now();
  const { state } = await import("./lib/platform");
  const { docs, passages } = await state().ready;
  console.log(`[boot] ingested ${docs.length} documents, ${passages.length} passages in ${Date.now() - t}ms`);
  if (process.env.DAYTONA_API_KEY) {
    const { getSandbox, warmTrends } = await import("./lib/daytona");
    const { record } = await import("./lib/platform");
    const t2 = Date.now();
    getSandbox()
      .then((sb) => {
        console.log(`[boot] daytona sandbox ${sb.id} ready in ${Date.now() - t2}ms`);
        return warmTrends(record.labs as Parameters<typeof warmTrends>[0]);
      })
      .catch((e) => console.log(`[boot] daytona warmup failed (lab trends will use local engine): ${String(e).slice(0, 120)}`));
  }
}
