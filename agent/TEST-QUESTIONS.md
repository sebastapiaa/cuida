# Test questions (use "Test AI agent" in the ElevenLabs dashboard)

Watch the server terminal or `GET /api/agent/feed` to see each tool call land.

| # | Say | Tool(s) it should call | Correct answer contains |
|---|---|---|---|
| 1 | (start) | get_daily_briefing | Greets Rosa; mentions Eliquis runs out Friday or the heart visit Thursday |
| 2 | "What's the pink pill for?" | get_medications or search_records | Eliquis, blood thinner, prevents stroke from AFib |
| 3 | "Can I take Advil for my knee?" | search_records | No: Dr. Chen's August note says no Advil/Motrin/Aleve with Eliquis, use Tylenol |
| 4 | "How much Tylenol can I take?" | get_medications or search_records | 1 to 2 tablets every 6 hours, max 3,000 mg a day (Dr. Ruiz) |
| 5 | "¿Cómo va mi azúcar?" | analyze_lab_trend (a1c) | Answers in Spanish: A1C went from 8.1 to 6.9, now at goal (under 7) |
| 6 | "When do I see my heart doctor?" | get_appointments | Thursday Nov 12, 10:30 AM, Pacific Heart Clinic, arrive 15 min early, Ana driving |
| 7 | "Ask him if there's a knee medicine safe with Eliquis" | add_question_for_doctor | Saved to the Dr. Chen visit on Thursday |
| 8 | "Can I eat before my blood test?" | search_records or get_appointments | No food after midnight Nov 17, water OK, take Eliquis, hold metformin until after eating |
| 9 | "I took my morning pills" | log_dose (all, morning) | Logged Eliquis, metformin, lisinopril, vitamin D |
| 10 | "Did I take my Eliquis this morning?" | get_medications | Yes, logged this morning (proves the write persisted) |
| 11 | "My blood pressure is 142 over 88" | log_home_reading | Saved; above her goal of under 130; mention to Dr. Chen Thursday |
| 12 | "Do I need to refill anything?" then "Yes, order it" | get_medications, request_refill, notify_family | Eliquis 0 refills, runs out Friday; sent to Harbor Pharmacy + Dr. Chen; $47 copay; Ana texted |
| 13 | "How much is my specialist copay?" | search_records | $20 |
| 14 | "Am I allergic to anything?" | search_records | Penicillin (hives), sulfa drugs (rash) |
| 15 | Curveball: "I have chest pain" | notify_family (urgent) | Tells her to call 911 now; texts Ana urgent |
| 16 | Curveball: "What's the weather?" / "Can I take Viagra?" | none / search_records | Politely redirects / says records have nothing, ask Dr. Ruiz or pharmacist |
