# Loom script (2:00 hard stop)

Judges score: works live x2, solves the problem x2, technical depth, curveballs, Daytona, demo. Every beat below maps to one.

| Time | You say / do | What the judge sees | Rubric |
|---|---|---|---|
| 0:00 | "My grandma calls my mom five times a day with questions her own records already answer. This is cuida. Our user is Rosa, 78. Finish line: she gets the answer without calling her daughter, and when something needs doing, cuida does it." | Full stage: Rosa's phone, behind-the-scenes panel, Ana's phone | Solves the problem |
| 0:15 | Tap the orb. As Rosa: **"What's the pink pill for?"** | Eliquis card slides up, `search_records` trace, reply time under 2s | Works live |
| 0:30 | **"Can I take Advil for my knee?"** While cuida answers, cut in: **"Wait, what about Tylenol?"** | Cites Dr. Chen's August note, stops mid-sentence and follows the new question | Curveballs, works live |
| 0:50 | Switch language: **"¿Y cómo va mi azúcar?"** | Answers in Spanish, `analyze_lab_trend` tagged DAYTONA SANDBOX, A1C sparkline 8.1 to 6.9 | Daytona, technical depth, ElevenLabs multilingual |
| 1:10 | Back to English: **"When do I see my heart doctor?"** | Thursday 10:30 card. cuida should mention Eliquis runs out Friday and offer a refill | Solves the problem |
| 1:25 | **"Yes, please order it, and let Ana know."** | `request_refill` + `notify_family`; Ana's phone gets the text; "Actions taken" shows the refill | Real action, finish line |
| 1:45 | Point at the metrics: "Average reply X seconds. Rosa got four answers and a refill, and Ana got one text instead of five calls. That's cuida." | Reply-time metrics, tool trace | Demo |

## If something goes sideways
- cuida does not offer the refill on its own: ask "Do I need to refill anything?"
- Mic picks up room noise: use the "Type instead of talking" box, the agent still answers out loud.
- Daytona chip says "not configured": `DAYTONA_API_KEY` is missing; the tool still works but is labeled LOCAL FALLBACK (do not demo it that way).

## Submission text
**cuida** · Track 03 Health and Care. **User:** Rosa, a 78-year-old bilingual senior managing 4 conditions and 6 medications. **Finish line:** she gets a correct, sourced answer about her own care in under 2 seconds without calling her daughter, and when action is needed cuida sends the refill to the pharmacy and texts her daughter Ana. Built with an ElevenLabs Agent (6 client tools, WebRTC, English and Spanish), a browser-side record index, and lab trend analysis that runs in a Daytona sandbox.
