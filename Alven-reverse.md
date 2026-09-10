# Alven — Reverse-Engineering Reference

Detailed descriptions of 7 Alven product screenshots (captured 2026-08-24), reconstructed
from close viewing. Alven is a competitor "AI employee that works as a PM and learns."
These are the design/feature reference for HDPM's internal version, **Dez**. The originals
were lost; this doc preserves what they showed.

**Visual system across all screens:** warm off-white background (~`#f4f1ea`/near-white),
generous whitespace, rounded cards (~16–20px radius), thin hairline borders, soft shadows,
black/near-black bold numerals, muted gray labels, a system/SF-style sans. Accent palette is
muted pastels — coral, dusty teal, warm amber, mauve/rose, dusty blue. Alven's avatar is a
**bronze liquid-metal orb "face."** Semantic color: green = good/positive delta, red/maroon =
bad/before-state.

---

## 1. `10.45.58` — "Alven's setup" (agent config / org view)

The onboarding/config canvas laid out like an org chart, connector lines fanning left→center→right.

- **Center:** Alven's identity card — the bronze liquid-metal orb avatar, name **"Alven"** below
  it, and a pill button **`🧠 View memory`**. A small hover toolbar (pin / mute / ⋯) floats over
  the avatar.
- **Top center:** the automation-level selector — a segmented control
  **`👁 Supervised` · `☑ Assisted` · `⚡ Autonomous`** with the caption **"Pick Alven's automation
  level."** Supervised is active. A notification **bell** sits to its right.
- **Left column (inputs / identity), stacked cards:**
  - **"Alven's phone" `[Live]`** → `+1 (516) 620-4193` with a copy icon.
  - **"Alven's email" `[Use yours]` `[Live]`** → `moonlight@alven.ai` with a copy icon.
  - **"Alven receives"** →
    - *Guest cards* — "Google Sheet not connected yet"; sources: Appfolio `1`, `bradleyzar11@gmail.com`; footnote **"1 in the last 30 days."**
    - *Work orders* — sources: Appfolio `2`, `bradleyzar11@gmail.com`, `Phone Call`; footnote **"2 in the last 30 days."**
- **Right column (connected systems), stacked cards:**
  - **PMS** → `Appfolio` (green status dot).
  - **Emails** → `bradleyzar11@gmail.com` (green dot).
  - **Calendars** → `Google Calendar — connect it so…` with a **`Connect`** button.
- **Bottom bar:** `👥 Team members [13 pending]` · `✏ Edit team` · `⊕ Invite teammates`.

**Takeaways for Dez:** agent-as-colleague with its own phone/email/avatar; visible **View memory**;
an **input-provenance panel** ("receives," with 30-day counts); connected-systems column with live status.

---

## 2. `10.50.32` — "Alven's setup" with the **Supervised** explainer popover

Same setup canvas, zoomed, with a plain-language popover open over the automation control.

- **Popover — "Supervised":**
  - **"How will you see what I do?"** → *"I will CC you in all my communications to vendors,
    tenants, landlords."*
  - **"How do you control me?"** → *"I ask your approval every time I want to reach out to
    someone — vendors, landlords, tenants."*
- **Left cards:** phone `+1 (201) 279-0820 [Live]`; email `abjny@alven.ai [Use yours][Live]`;
  **"Alven receives → Work orders"** from `joe@abjny.com`, footnote **"68 in the last 30 days."**
- **Right cards:** PMS `Appfolio`; **Emails** → `kathleen@abjny.com` ("Gmail · not polled yet")
  and `joe@abjny.com` (green); **Calendars** → `Google Calendar`.
- **Top edge:** partial buttons `Email` / `Connect Drive` / `Calendar`.

**Takeaways for Dez:** the 3-tier autonomy is explained in *first-person plain language* ("I'll CC
you", "I ask your approval every time"). This is the single most "obvious"-making pattern —
maps directly onto HABU's L0–L4 ladder as a friendly UI.

---

## 3. `10.52.08` — Delinquency chat (WhatsApp thread, split view)

- **Left panel:** tabs **`📊 Reporting` / `💳 Delinquencies`** + `✕ Clear`. A board with columns
  **"Chasing 0"** and **"● Committed to pay"** — both empty ("Nothing here").
- **Right panel — conversation thread** with a provider, every message tagged with channel/role
  badges: `+15165099674` `[Provider]` `[WhatsApp]`, timestamps.
  - *Tue 11 Aug* — Provider: **"Hey alven - its joe - just testing whatsapp."**
  - *Wed 12 Aug 12:00 AM* — Alven: **"Hey Joe — WhatsApp is working. I got your…"**
  - Provider (12:16): **"can you send me a delinquency report for all units - i will select which
    units for you to call/text."**
  - Alven (12:17): **"Yes — I'll send you the delinquency report for the … with each tenant's full
    outstanding ledger balance … 15 minutes. You can then mark who you want me to…"**
  - Provider (12:18): **"thanks, if you can mark if they are on section 8 (nycha, hpd, htfc) that
    would be helpful as well."**
- Provider messages have blue circular avatars; Alven's are warm-toned bubbles.

**Takeaways for Dez:** one thread per topic, **channel badges** (WhatsApp/Provider), agent negotiates
scope conversationally; a delinquency board (Chasing / Committed to pay).

---

## 4. `10.55.05` — Delinquency thread **detail** with materials + a saved memory note

- **Header:** **"Delinquency selections and ledger balances — Joe Soleimani · sc…"** with archive + `✕`.
- **`MATERIALS · 3`** — three file chips: `abj_delinquency_se…`, `whatsapp_abj_delin…`, `abj_delinquency_se…`.
- **Thread:**
  - Alven: *"…rent. It lists **82 occupancies totaling $522,303.04**, with 30+ day balances, last
    payments, and legal/subsidy flags. Mark the Select column or send me the property/unit numbers
    you want called or texted, and I'll only contact those."*
  - Attachment chip: **`abj_delinquency_select…xlsx  13 KB`**.
  - Provider (WhatsApp): **"alven - in the meantime - can you set this up to come to me every
    tuesday at 7:30am EST."**
  - Alven AI (12:27 AM, tagged `WhatsApp` `Provider` `+15165099674 ← Alven AI`, bronze avatar):
    **"Done — I've scheduled the updated delinquency report for every Tuesday at 7:30 AM ET, starting
    August 18. It'll include full ledger balances and Section 8 program markers, and I'll wait for
    your unit selections before contacting anyone."**
  - **Memory-capture line (🧠 brain icon):** *"Saved a note: [PM: Joe Soleimani] Send the scoped
    delinquency selection report every Tuesday at 7:30 AM ET, **with full ledger balances and
    NYCHA/HPD/HTFC…**"* (the ledger/subsidy clause highlighted).

**Takeaways for Dez:** **materials attached to a thread** (the agent's produced files); **routines**
("every Tuesday 7:30am") created conversationally; **visible memory capture** inline — "Saved a note:
[PM: name] …" — the "learns" behavior made tangible.

---

## 5. `10.56.01` — Tasks kanban (Maintenance) with an agent **plan + Approve**

- **Header:** **"Tasks 24"**, list/grid toggle, notification badge `9+`. Sub-tabs **"Tasks · 24 / Routines."**
  Search bar. Filter row: `⧉ All` · `🔧 Maintenance` (active) · `👤 Leasing` · `Check Outs` · `📊 Reporting`
  · `💳 Delinquencies` · `✕ Clear` · date range **"Last 7 days · 18–24 Aug"** · avatars · `Closed` ·
  `Filters` · **`+ New task`** (black button).
- **Kanban columns (count):** **Reported 7 · Diagnosed 1 · Vendor picked 3 · Dispatched 2 ·
  Reported fixed 3 · Fixed.**
- **Cards** show property LLC (597 Grand Holdings, 315 Lincoln, 323 Lincoln, Claremont Homes), a
  🔧 wrench + issue title (e.g. *Recurring roaches in common areas*, *Missing tub caulking and
  recurring mold*, *Rodent droppings and fly-source follow-up*, *Intermittent hissing radiator pipe*,
  *All four radiators heating in summer*, *Recurring kitchen-ceiling mold*, *Recurring low building
  hot water*, *Refrigerator not cooling*, *Burning smell from dryer*, *Broken mailbox lock*), a date,
  a status pill, and vendor tags (`HandyMannyLLC`, `Runwise Support`).
- **Left overlay — open task detail:** **"LL97 prescriptive work scope / 597 Grand Holdings LLC.
  - 597 Grand Avenue Brooklyn."** Line: *"Joe assigned Gabriel the LL97 onsite work."* Then
  **"THEN, MY PLAN"** — a numbered plan:
  1. Once the ReDocs contact is available, I'll send the clarification request.
  2. I'll obtain confirmed switch locations, quantities, controls, and wiring requirements.
  3. I'll request itemized pipe-insulation and weather-stripping materials and specifications.
  4. I'll coordinate Gabriel's onsite LL97 work after requirements and materials are confirmed.
  5. I'll verify the completed adjustments and installations with the tenant.
  6. I'll report completion and outstanding ReDocs items to the PM.
  …and a green **`✓ Approve`** button.

**Takeaways for Dez:** this is HABU's jacket board + self-closing loop — the columns are a workflow
pipeline; the killer detail is the **agent's plan shown inline ("THEN, MY PLAN") above a one-tap
Approve**, making the reasoning legible before the human commits.

---

## 6. `10.57.18` — KPI dashboard (Leasing / Occupancy)

- **Top: a Sankey flow ribbon.** Left gray source bar **"44 · 100% · Notices"**; a soft rose ribbon
  narrows rightward to two end bars: **"0 · 0% · Moved out"** (top) and **"−44 · Still in unit · 100%"**
  (bottom, maroon).
- **4-column stat-tile grid.** Each tile = small gray label → big bold black number → a delta line
  (`▼16.0% vs last week`, green good / red bad) → a **soft-gradient area sparkline** with an
  emphasized endpoint, each tile its own muted pastel.
  - Row 1: **Vacant units 172** (▼16.0%, green) · **Ready for leasing 54** (▼44.0%) · **Pre-leased
    units 34** (▼26.0%, red) · **Lease expirations (90d) 207** (▼6.0%, red).
  - Row 2: **Move-outs (next 30d) 32** · **Move-ins (next 30d) 67** · **Move-ins (last week) 32** ·
    **Make-ready time 4** with a maroon **`25* before Alven`** and ▼25.0%, its sparkline carrying a
    pill **`🌰 Alven on · Jun 10`**.

**Takeaways for Dez:** the funnel ribbon; the 4-up gradient-sparkline tiles; and the signature
**"before Alven"** baseline in maroon beside the current number + the **"Alven on · <date>"**
sparkline annotation marking the inflection.

---

## 7. `10.57.30` — KPI dashboard (Work Orders / Maintenance)

- **Top: a Sankey flow ribbon** splitting to maroon end bars: **"−45 · No estimate · 23%"**,
  **"−3 · Never assigned · 2%"**, **"−83 · Not done · 55%"**.
- **Floating hover detail card (provenance):** **"Avg days to close / 4.1 days / Source · [a] Work
  Orders · Aug 18, 9:32 PM."**
- **4-column grid:**
  - **This week's work orders 198** — rendered as a **colored bento/treemap** of category counts:
    29 Uncategorized (coral), 9 Wat… (mauve), 6 F…, 21 A… (teal), 11 E… (amber), 8 D… (gray),
    114 Other (teal).
  - **Avg days to close 4.1 days** with maroon **`20 days* before Alven`**; sparkline + pill
    **`🌰 Alven on · Apr 27`**.
  - **Open work orders 253** (▼1.0% vs last week).
  - **Maintenance spend (MTD) $96,366** (▼52.0% vs July; ascending amber sparkline).
  - Row 2: **Google rating 4.8 ★** with **`4.2 ★* before Alven`** (▲3.0%) · **Maintenance first
    response (min) 30 sec** with **`48 min* before Alven`** (▼29.0%), pills `Alven on · Apr 27`.

**Takeaways for Dez:** provenance hover cards (`Source · … · timestamp`); the **category bento tile**;
special value formats (`4.8 ★`, `30 sec`, `$96,366`); and again the **"before Alven"** impact framing
on every agent-moved metric.

---

## Cross-cutting patterns to carry into Dez

1. **Plain-language 3-tier autonomy** (Supervised/Assisted/Autonomous) with "how you see me / how you
   control me" copy — friendlier surface over HABU's L0–L4.
2. **Visible, editable agent memory** — "View memory" + inline "Saved a note: [PM: name] …".
3. **Agent-as-colleague identity** — own phone, email, avatar.
4. **Input-provenance panel** ("receives," with 30-day counts) + **per-metric source hover cards**.
5. **One thread per topic across channels** with channel badges; **materials** attached to threads.
6. **Agent plan shown inline** ("THEN, MY PLAN") above a one-tap **Approve** on the task card.
7. **Routines** — recurring scheduled agent tasks created conversationally.
8. **"before Dez" impact baselines** on the KPI dashboard — the standout idea; every agent-moved
   metric shows its pre-agent value in maroon, plus an "Dez on · <date>" sparkline marker.

*Note: Dez is internal staff-efficiency-focused, so adopt these interaction patterns but keep Dez
pointed inward (draft-for-staff), not auto-sending to tenants/owners — owner/tenant sends stay
hard-walled at L2 per the restart plan.*
