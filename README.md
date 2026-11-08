# cuida

**Every health record, answered out loud.** cuida centralizes a senior's health records (pharmacy list, lab reports, visit summaries, appointment letters, insurance) into one knowledge base, and an ElevenLabs voice agent answers any question about them in about 2 seconds, in English or Spanish. The agent does not just read: it writes back to the platform (doses taken, home readings, questions for the doctor, refills, texts to family).

- **Track:** 03 · Health and Care (fictional patient, all data fake)
- **User:** Rosa Delgado, 78, bilingual, 4 conditions, 6 medications, daughter Ana lives 30 minutes away
- **Finish line:** Rosa gets a correct, sourced answer about her own care without calling Ana. When something needs doing, cuida does it in the platform (refill sent, question saved, reading logged) and texts Ana.

## Architecture

```
Rosa (voice) ─► ElevenLabs Agent ──webhook tools (HTTPS + x-cuida-key)──► cuida platform API (Next.js)
                                                                            │
          records/*.pdf ── ingested at boot (unpdf) ──► passage index (BM25 + EN/ES expansion)
          src/data/rosa.json ── normalized record (meds, appointments, labs)
          in-memory state ── doses, home readings, doctor questions, refills, family texts
          Daytona sandbox ── analyze_lab_trend runs as Python
          GET /api/agent/feed ── every tool call + write, for the demo screen
```

### The 11 agent tools (`agent/tools.json`)
| Tool | Endpoint | Reads / writes |
|---|---|---|
| get_daily_briefing | GET /api/agent/briefing | today's meds + what's taken, appointments in 10 days, refill alerts |
| search_records | GET /api/agent/search?q= | excerpts from the uploaded PDFs, with document + date |
| read_document | GET /api/agent/documents?id= | full text of one document |
| get_medications | GET /api/agent/medications | dose, pill look, purpose, refills, runs-out date, taken today |
| log_dose | POST /api/agent/doses | **writes** dose taken |
| get_appointments | GET /api/agent/appointments | upcoming with prep + saved questions, or past visits |
| add_question_for_doctor | POST /api/agent/appointments/questions | **writes** a question to an appointment |
| analyze_lab_trend | POST /api/agent/labs | trend math in a **Daytona** sandbox |
| log_home_reading | POST /api/agent/vitals | **writes** BP / sugar / weight / HR, returns flag + guidance |
| request_refill | POST /api/agent/refills | **writes** refill request (pharmacy + prescriber if 0 refills) |
| notify_family | POST /api/agent/family | **writes** text to Ana (real SMS if Twilio is set) |

### Mock records (`records/`)
Nine realistic PDFs generated from `src/data/rosa.json` by `npm run records`: health summary, pharmacy medication list, lab report, three after-visit summaries, eye exam, appointment letters, insurance benefits. Edit the JSON and regenerate to change the story.

## Run it (about 5 minutes)

```bash
npm install
cp .env.example .env.local     # add ELEVENLABS_API_KEY (and DAYTONA_API_KEY)

# terminal 1
npm run dev

# terminal 2: public HTTPS URL so ElevenLabs can reach your laptop
npm run tunnel                 # copy the https://xxxx.trycloudflare.com URL

# terminal 3: create (first run) or sync (every later run) the agent + tools
PUBLIC_URL=https://xxxx.trycloudflare.com npm run sync:agent
# first run generates CUIDA_AGENT_KEY: restart terminal 1 (npm run dev) once
```

The script ends with a reachability check and a link to the agent. Open it, click **Test AI agent**, and run through `agent/TEST-QUESTIONS.md`.

**Re-run `npm run sync:agent` whenever** the tunnel URL changes (it changes every time `npm run tunnel` restarts), or after editing `agent/system-prompt.md` or `agent/tools.json`. It updates the same agent and tools in place.

### In the ElevenLabs dashboard (one time)
1. Agent tab, **Additional languages:** add Spanish.
2. **Voice:** a warm, slightly slower voice. **LLM:** the fastest one listed (Flash / mini).
3. **Advanced:** turn eagerness "eager" if replies start slowly.

### Watching the agent touch the data
`curl localhost:3000/api/agent/feed` shows every tool call (with ms), and every dose, reading, question, refill and text the agent wrote. `curl -X DELETE localhost:3000/api/agent/feed` resets the demo.

## Deploy on Vercel

1. Import the GitHub repo in Vercel (framework Next.js, root directory `.`; defaults are fine).
2. Storage -> add **Upstash Redis** from the Marketplace and connect it to the project. It injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; without them each serverless instance keeps its own memory and the agent's writes may not show on the screen.
3. Environment variables (Production): `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `CUIDA_AGENT_KEY` (same value as in your `.env.local`), `DAYTONA_API_KEY`, optional `DAYTONA_SANDBOX_ID`, optional Twilio vars.
4. Deploy, then point the agent's tools at the deployment from your laptop:

   ```bash
   PUBLIC_URL=https://<your-app>.vercel.app npm run sync:agent
   ```

   Re-run it if you later switch back to the local tunnel (`npm run up` does that for you).

## Status
- Done: mock records, ingestion + search, 11 read/write endpoints, agent prompt + tools, sync script.
- On hold: the phone-mockup demo screen (`src/components/Stage.tsx`) still uses the earlier client-tool version; it will be rewired to read `/api/agent/feed`.
