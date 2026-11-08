"""Generate cuida's mock health record documents (PDF) from src/data/rosa.json.

These are the "uploaded records" the platform ingests. Fictional patient, demo only.
Run: python3 scripts/make-records.py
"""
import json
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "src/data/rosa.json").read_text())
OUT = ROOT / "records"
OUT.mkdir(exist_ok=True)

P = R["patient"]
MRN = "BFM-0048213"
INK = colors.HexColor("#1d2b24")
MUTED = colors.HexColor("#5b655f")
LINE = colors.HexColor("#d9d4cc")

ss = {
    "h1": ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=INK, spaceAfter=2),
    "org": ParagraphStyle("org", fontName="Helvetica", fontSize=9, leading=12, textColor=MUTED),
    "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=INK, spaceBefore=12, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, leading=11, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8.8, leading=11.5, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Helvetica-Bold", fontSize=8.8, leading=11.5, textColor=INK),
}


def fmt(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%B %-d, %Y")


def footer(c, doc):
    c.saveState()
    c.setFont("Helvetica", 7.5)
    c.setFillColor(MUTED)
    c.drawString(0.75 * inch, 0.5 * inch, "SAMPLE RECORD  |  FICTIONAL PATIENT  |  FOR CUIDA DEMO ONLY")
    c.drawRightString(LETTER[0] - 0.75 * inch, 0.5 * inch, f"Page {doc.page}")
    c.restoreState()


def table(rows, widths, header=True):
    data = [[Paragraph(str(x), ss["cellb" if (header and i == 0) else "cell"]) for x in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1ece4")))
    t.setStyle(TableStyle(style))
    return t


def patient_box(extra=()):
    rows = [
        ["Patient", P["name"], "DOB", fmt(P["dob"]) + f" (age {P['age']})"],
        ["MRN", MRN, "Preferred language", " / ".join(P["languages"])],
    ] + list(extra)
    t = Table([[Paragraph(str(x), ss["cellb" if j % 2 == 0 else "cell"]) for j, x in enumerate(r)] for r in rows],
              colWidths=[0.9 * inch, 2.4 * inch, 1.3 * inch, 2.4 * inch])
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#faf8f4")),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t


def build(filename, org, title, story, extra=()):
    doc = SimpleDocTemplate(str(OUT / filename), pagesize=LETTER, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.7 * inch, bottomMargin=0.8 * inch, title=title, author=org)
    head = [Paragraph(org, ss["org"]), Paragraph(title, ss["h1"]), Spacer(1, 6), patient_box(extra), Spacer(1, 4)]
    doc.build(head + story, onFirstPage=footer, onLaterPages=footer)
    print("wrote", filename)


def team(name):
    return next(t for t in R["careTeam"] if t["name"] == name)


H2 = lambda s: Paragraph(s, ss["h2"])
Pp = lambda s: Paragraph(s, ss["p"])
W = 7.0 * inch

# 01 Patient health summary -------------------------------------------------
ruiz = team("Dr. Elena Ruiz")
build("01-patient-health-summary.pdf", f"{ruiz['clinic']}  |  {ruiz['address']}  |  {ruiz['phone']}", "Patient Health Summary", [
    Pp(f"Printed {fmt('2026-10-01')}. Primary care physician: {ruiz['name']}."),
    H2("Active problems"),
    table([["Condition", "Since", "Notes"]] + [[c["name"], c["since"], c["plain"]] for c in R["conditions"]], [2.3 * inch, 0.7 * inch, 4.0 * inch]),
    H2("Allergies"),
    table([["Substance", "Reaction", "Recorded"]] + [[a["substance"], a["reaction"], a["noted"]] for a in R["allergies"]], [2.3 * inch, 2.7 * inch, 2.0 * inch]),
    H2("Care team"),
    table([["Name", "Role", "Location", "Phone"]] + [[t["name"], t["role"], f"{t['clinic']}, {t['address']}" + (f" ({t['hours']})" if t.get('hours') else ""), t["phone"]] for t in R["careTeam"]],
          [1.5 * inch, 1.6 * inch, 2.8 * inch, 1.1 * inch]),
    H2("Emergency contacts"),
    table([["Name", "Relationship", "Phone", "Primary"]] + [[f["name"], f["relation"].title(), f["phone"], "Yes" if f["primary"] else "No"] for f in P["family"]],
          [2.0 * inch, 1.6 * inch, 1.8 * inch, 1.6 * inch]),
    H2("Immunizations"),
    table([["Vaccine", "Date given"]] + [[v["name"], fmt(v["date"])] for v in R["vaccines"]], [4.5 * inch, 2.5 * inch]),
])

# 02 Pharmacy medication list -----------------------------------------------
ph = team("Harbor Pharmacy")
rows = [["Medication", "Directions", "What it's for", "Looks like", "Prescriber", "Last fill / supply / refills"]]
for m in R["medications"]:
    fill = f"{fmt(m['lastFilled'])} / {m['daysSupply']} days / {m['refillsLeft']} left" if m["lastFilled"] else "Over the counter"
    rows.append([f"{m['name']} {m['dose']}", m["howToTake"], m["purpose"], m["appearance"], m["prescriber"], fill])
build("02-pharmacy-medication-list.pdf", f"{ph['clinic']}  |  {ph['address']}  |  {ph['phone']}  |  {ph['hours']}", "Current Medication List", [
    Pp(f"Printed {fmt('2026-10-20')}. Bring this list to every appointment."),
    Spacer(1, 6),
    table(rows, [1.15 * inch, 1.45 * inch, 1.1 * inch, 0.95 * inch, 0.95 * inch, 1.4 * inch]),
    H2("Pharmacist notes"),
    Pp("Eliquis (apixaban): no refills remaining on file. A new prescription from Dr. Marcus Chen is needed before the next fill. "
       "Avoid ibuprofen (Advil, Motrin) and naproxen (Aleve) while taking Eliquis. Acetaminophen (Tylenol) is the preferred pain reliever."),
    Pp("Metformin: take with meals to reduce stomach upset."),
], extra=[["Rx plan", R["insurance"]["plan"], "Member ID", R["insurance"]["memberId"]]])

# 03 Lab report --------------------------------------------------------------
labs = R["labs"]
latest = [
    ["Test", "Result", "Flag", "Goal / reference", "Previous (Feb 24, 2026)"],
    ["Hemoglobin A1C", "6.9 %", "", "Goal below 7.0 %", "7.2 %"],
    ["LDL cholesterol", "88 mg/dL", "", "Goal below 100 mg/dL", "96 mg/dL"],
    ["HDL cholesterol", "52 mg/dL", "", "Above 50 mg/dL", "49 mg/dL"],
    ["Triglycerides", "141 mg/dL", "", "Below 150 mg/dL", "158 mg/dL"],
    ["eGFR (kidney function)", "65 mL/min", "", "Above 60 mL/min", "67 mL/min"],
    ["Creatinine", "0.92 mg/dL", "", "0.50 to 1.10 mg/dL", "0.89 mg/dL"],
    ["Potassium", "4.6 mmol/L", "", "3.5 to 5.1 mmol/L", "4.4 mmol/L"],
    ["Fasting glucose", "124 mg/dL", "H", "70 to 99 mg/dL", "131 mg/dL"],
]
hist = [["Date", "A1C (%)", "LDL (mg/dL)", "eGFR (mL/min)"]]
for i, (d, v) in enumerate(labs["a1c"]["series"]):
    hist.append([fmt(d), v, labs["ldl"]["series"][i][1], labs["egfr"]["series"][i][1]])
build("03-lab-report-2026-09-15.pdf", "Bayview Family Medicine Laboratory  |  CLIA 05D0000000 (sample)", "Laboratory Report", [
    Pp(f"Collected {fmt('2026-09-15')} 8:10 AM, fasting. Ordering provider: Dr. Elena Ruiz. Reported {fmt('2026-09-16')}."),
    H2("Results"),
    table(latest, [1.8 * inch, 1.0 * inch, 0.5 * inch, 1.7 * inch, 2.0 * inch]),
    H2("Result history"),
    table(hist, [2.2 * inch, 1.5 * inch, 1.6 * inch, 1.7 * inch]),
    H2("Provider comment"),
    Pp("A1C is now at goal for the first time since 2024. Kidney function is stable and safe for metformin. Cholesterol at goal. "
       "Fasting glucose slightly high, continue current plan. Recheck A1C and lipids in 2 months. -- Dr. Elena Ruiz"),
], extra=[["Specimen", "Blood, venous", "Accession", "L26-091544"]])

# 04/05/08 After-visit summaries -------------------------------------------
def avs(fname, visit, clinic_name, vitals, plan, followup):
    t = team(visit["with"])
    build(fname, f"{t['clinic']}  |  {t['address']}  |  {t['phone']}", "After Visit Summary", [
        Pp(f"Visit date: {fmt(visit['date'])}. Provider: {visit['with']}, {t['role']}."),
        H2("Vital signs"), table(vitals, [3.5 * inch, 3.5 * inch]),
        H2("What we talked about"), Pp(visit["summary"]),
        H2("Your plan"), *[Pp("- " + x) for x in plan],
        H2("Follow-up"), Pp(followup),
    ])

V = {v["id"]: v for v in R["visits"]}
avs("04-after-visit-summary-2026-09-22-dr-ruiz.pdf", V["visit-2026-09-22"], "", [["Measure", "Value"], ["Blood pressure", "128/76"], ["Heart rate", "72 (irregular)"], ["Weight", "159 lb"], ["Temperature", "98.1 F"]],
    ["Keep metformin 500 mg twice a day with meals.", "Walk 20 minutes a day, 5 days a week.", "Knee pain: Tylenol 500 mg, 1 to 2 tablets every 6 hours as needed. No more than 3,000 mg in a day.",
     "Referral sent to Coastal Physical Therapy for the right knee. They will call to schedule.", "Flu shot given today in the left arm."],
    "Fasting labs on November 17, 2026. Diabetes check with Dr. Ruiz on December 3, 2026.")
avs("05-after-visit-summary-2026-08-05-dr-chen.pdf", V["visit-2026-08-05"], "", [["Measure", "Value"], ["Blood pressure", "132/78"], ["Heart rate", "76 (irregular, rate controlled)"], ["Weight", "160 lb"]],
    ["Continue Eliquis (apixaban) 5 mg twice a day, about 12 hours apart. Do not stop unless Dr. Chen tells you to.",
     "Do NOT take ibuprofen (Advil, Motrin) or naproxen (Aleve). They raise bleeding risk with Eliquis. Use Tylenol for pain.",
     "Call 911 for chest pain, fainting, face drooping, arm weakness, trouble speaking, or bleeding that will not stop.",
     "Call the clinic for black stools, pink urine, or easy bruising."],
    "Cardiology follow-up in 3 months: November 12, 2026 at 10:30 AM. A new Eliquis prescription can be sent at that visit or by calling the office.")
avs("08-after-visit-summary-2026-03-10-dr-ruiz.pdf", V["visit-2026-03-10"], "", [["Measure", "Value"], ["Blood pressure", "148/90"], ["Weight", "162 lb"]],
    ["Lisinopril increased from 5 mg to 10 mg every morning.", "Check blood pressure at home 3 times a week and write it down.", "Limit salt."],
    "Recheck in 6 months.")

# 06 Appointment reminders ---------------------------------------------------
story = [Pp(f"Upcoming appointments as of {fmt('2026-11-01')}.")]
for a in R["appointments"]:
    story += [H2(f"{a['type']}"), table([["When", f"{date.fromisoformat(a['date']).strftime('%A, %B %-d, %Y')} at {a['time']}"], ["With", a["with"]], ["Where", a["where"]], ["How to prepare", a["prep"]]], [1.4 * inch, 5.6 * inch], header=False)]
build("06-upcoming-appointments.pdf", "cuida care calendar  |  compiled from clinic reminder letters", "Upcoming Appointments", story)

# 07 Insurance ---------------------------------------------------------------
ins = R["insurance"]
build("07-insurance-benefits-summary.pdf", f"{ins['plan']}  |  Member services {ins['phone']}", "2026 Benefits Summary", [
    table([["Benefit", "You pay"], ["Primary care visit", "$0"], ["Specialist visit (cardiology, eye)", "$20"], ["Lab work", "$0"], ["Physical therapy", "$15 per visit"],
           ["Emergency room", "$90 (waived if admitted)"], ["Tier 1 generic drugs (metformin, lisinopril, atorvastatin)", "$0 for 90 days"], ["Brand drugs: Eliquis (apixaban)", "$47 per 30-day fill"],
           ["Annual out-of-pocket maximum", "$3,900"]], [4.5 * inch, 2.5 * inch]),
    H2("Notes"), Pp("HMO plan: specialists need a referral from your primary care doctor, Dr. Elena Ruiz. Free rides to medical appointments: call member services 2 days ahead."),
], extra=[["Plan", ins["plan"], "Member ID", ins["memberId"]]])

# 09 Eye exam ----------------------------------------------------------------
avs("09-eye-exam-2025-12-02-dr-navarro.pdf", V["visit-2025-12-02"], "", [["Measure", "Value"], ["Vision (with glasses)", "20/30 right, 20/25 left"], ["Eye pressure", "16 / 15 mmHg (normal)"]],
    ["No diabetic eye disease found.", "New reading glasses prescription (+2.25)."], "Yearly diabetic eye exam: January 14, 2027 at 11:00 AM. Eyes will be dilated; bring a driver.")
