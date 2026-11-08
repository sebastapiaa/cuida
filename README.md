# cuida

**Every health record, answered out loud.** A voice agent for seniors that indexes their health records and answers any question about them in under 2 seconds, in English or Spanish. When something needs doing (a refill, a heads-up to family), it does it.

- **Track:** 03 · Health and Care (all patient data is fake)
- **User:** Rosa Delgado, 78, bilingual, 4 conditions, 6 medications, lives 30 minutes from her daughter Ana
- **Finish line:** Rosa gets a correct, sourced answer about her own care without calling her daughter. When action is needed, cuida sends the refill request to the pharmacy and texts Ana.

## How it works

```
Rosa talks ──► ElevenLabs Agent (WebRTC, STT ► LLM ► TTS)
                    │ client tool calls
                    ▼
   browser record index (32 chunks, EN/ES synonyms)  ── search_records, get_medication_schedule, get_appointments
   Daytona sandbox (Python trend analysis)            ── analyze_lab_trend
   Next.js server actions (+ optional Twilio SMS)     ── request_refill, notify_family
```

- `src/data/rosa.json`: the fake patient record (meds with pill descriptions, appointments, visit notes, labs, allergies, care team, insurance).
- `src/lib/records.ts`: chunks the record and builds a weighted keyword index with plain-language and Spanish synonyms ("the pink pill", "la pastilla rosa", "my heart doctor"). Searches run in under 1 ms.
- `agent/system-prompt.md` + `agent/tools.json`: the agent definition. Tools are ElevenLabs **client tools**, so the UI can show each record as the agent finds it.
- `src/app/api/analyze`: runs the lab trend analysis as Python inside a **Daytona** sandbox (pre-warmed on page load).
- `src/app/api/token`: mints a private WebRTC conversation token so the API key never reaches the browser.
- `src/app/api/actions`: refill requests and family messages. Sends a real SMS to `FAMILY_PHONE` if Twilio is configured.
- The stage shows **reply time** per turn (end of Rosa's turn to cuida's first audio), so the 2-second claim is measured, not asserted.

## Setup (about 5 minutes)

```bash
npm install
cp .env.example .env.local      # add ELEVENLABS_API_KEY and DAYTONA_API_KEY
npm run setup:agent             # creates the 6 tools + the agent, writes the agent id to .env.local
npm run dev                     # http://localhost:3000
```

Then in the ElevenLabs dashboard, open the **cuida** agent:
1. **Agent tab > Additional languages:** add Spanish (lets Rosa switch mid-call).
2. **Voice:** pick a warm, slower voice. **LLM:** pick the fastest available (a Flash or mini model) for sub-2s replies.
3. **Advanced:** turn eagerness to "eager" if replies feel slow to start.

If `setup:agent` fails, create the agent by hand: paste `agent/system-prompt.md` as the system prompt, set the first message, and add each tool in `agent/tools.json` as a **Client** tool with **Wait for response** on and the same name and parameters.

Test tools without voice from the browser console: `__cuida.search_records({ query: "pink pill" })`.

## Demo tips
- Record in Chrome at 1440x900 or larger, zoom 100%, full screen.
- Use headphones so cuida does not hear itself and interrupt.
- Click **reset demo** (top right of the middle panel) between takes.
