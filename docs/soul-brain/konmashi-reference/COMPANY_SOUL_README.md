# Company Soul — Build & Demo Guide

**For:** Ryan
**Branch:** `feature/company_soul` (merged to `main`, live on Vercel)
**Goal:** The Company Soul Interview Agent: Craig talks for 20–30 minutes,
presses one button, and `HDPM.company.soul.md` appears. Success = everyone in
the room says *"That is exactly HDPM."*

Read [docs/company-soul-prd.md](docs/company-soul-prd.md) first (5 minutes).
It explains the why; this doc is the how.

**Implementation specs (June 2026):**

- [docs/company-soul-change-spec.md](docs/company-soul-change-spec.md) — structured JSONB canonical soul, page/API changes, phasing
- [docs/company-soul-readiness-gate.md](docs/company-soul-readiness-gate.md) — scriptwriter readiness check + enhancement chat → merge into soul

---

## What this is, in one paragraph

The first agent a Konmashi customer meets is not a content creator — it's an
interviewer. It extracts the founder's tacit knowledge through a voice-first,
story-driven conversation and composes it into a versioned `company.soul.md`:
the context layer every future Kroid reads. The interview is **living** — the
soul shows you its own gaps, and you click a gap to be interviewed on it. No
content generation, no crawlers, no vector DB in V1. One interviewer. One soul.

### The core loop (this is the philosophy, made into UX)

```
Talk (voice or text)  →  Generate Soul  →  see the holes (confidence % + gaps)
        ↑                                              │
        └──────  click a gap pill to be interviewed on it  ←─┘
```

Every pass raises the confidence score and turns more section chips green. The
score *is* the incentive Craig's article describes: a founder watching
"48% → 71%" is being paid in leverage to externalize what's in their head.

### What is recorded vs. discarded

- **Recorded forever** (Supabase, RLS-protected, the system of record):
  every interview turn — your answers *and* the interviewer's questions —
  plus every generated/edited soul version. The raw transcript is the most
  valuable asset; future smarter composers (and the Phase-2 Brain) re-mine it.
- **Discarded:** the audio blob (voice → Whisper → text, audio dropped), and
  the internal steering messages (Start nudge, gap-pill pivots) — those are
  injected at request time and never written to the transcript, so the record
  stays a clean human conversation.

## Where everything lives

| Piece | Path |
|---|---|
| PRD (direction + scope) | `docs/company-soul-prd.md` |
| Change spec (structured soul + page) | `docs/company-soul-change-spec.md` |
| Scriptwriter readiness gate | `docs/company-soul-readiness-gate.md` |
| Interviewer agent (Mastra) | `src/mastra/agents/company-soul-interviewer-agent.ts` |
| Agent registration | `src/mastra/index.ts` |
| Soul Composer (3-pass: map → compose → score) | `src/lib/soul/compose.ts` |
| Coverage map / shared types / founder arc | `src/lib/soul/sections.ts` |
| API routes | `src/app/api/soul/**` |
| Demo UI | `src/app/dashboard/developer-admin/company-soul/page.tsx` |
| Sidebar entries (both Developer menus) | `src/components/dashboard/Sidebar.tsx` |
| Security headers (mic Permissions-Policy) | `src/lib/security/security-headers.ts` |
| Migrations (2) | `supabase/migrations/20260609120000_company_soul.sql`, `supabase/migrations/20260609130000_company_soul_metadata.sql` |

### How the pieces talk

```
Founder voice (MediaRecorder + live waveform, browser)
      ↓  POST /api/soul/transcribe        (OpenAI whisper-1)
transcript text
      ↓  POST /api/soul/interviews/[id]/chat   (content, or focus=<gap topic>)
CompanySoulInterviewer (Mastra, gpt-4o, memory thread soul-interview-<id>)
      ↓  every turn persisted to soul_interview_turns
      ↓  POST /api/soul/compose           (pulls ALL turns for the company)
Soul Composer (gpt-4o, 3 passes — see below)
      ↓
soul_files row: content + confidence % + per-section coverage + gaps[]
      ↓  UI: coverage strip / gap pills / preview / edit (new version) / download
```

### How the composer avoids losing knowledge (important)

The composer is **three passes**, specifically so regenerating on a long
interview never drops what an earlier version captured:

1. **MAP** — scan the *entire* transcript section by section and extract every
   relevant statement/quote. Forces attention across all 40+ turns (defeats
   "lost in the middle").
2. **COMPOSE** — write the soul from those notes **plus the previous soul
   version, treated as a floor**: the new soul must be a superset; nothing
   already captured (especially Mission & Vision) is dropped.
3. **SCORE** — coverage % per section + up to 6 missing-knowledge gaps.

The chat route mirrors `src/app/api/business-assessment/agent/chat/route.ts`
if you want a reference for agent chat elsewhere in the app.

---

## Setup steps (do these in order)

### 1. Run the two migrations

The feature is merged and deploying, but the **migrations are not auto-run** —
confirm both have been applied to the database the deployment points at. Either:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

or paste both files into the Supabase Studio SQL editor and run them
(`20260609120000` first, then `20260609130000`). Both are additive-only —
three new tables (`soul_interviews`, `soul_interview_turns`, `soul_files`)
with RLS, then three nullable columns. Nothing existing is touched. If Start
Interview 500s, the migrations haven't run yet.

### 2. Verify env vars

| Var | Needed for | Status |
|---|---|---|
| `OPENAI_API_KEY` | Interviewer, Composer, Whisper | Already in the project env |
| `MASTRA_MEMORY_DATABASE_URL` | Mastra conversation memory | Optional — chat works without it (history is replayed from Supabase every turn), but set it if it's set in other envs |
| Supabase URL / service role / anon | Auth + storage | Already in the project env |

No new env vars are required.

### 3. Build & run (for local work)

```bash
git checkout main && git pull
npm install
npm run type-check     # pre-existing errors in tests/*.ts are known; src/ is clean
npm run dev
```

**Microphone needs a secure context.** `https://…` (the Vercel URL) or
`http://localhost` work; a LAN IP over plain `http` will not get mic access.
The site-wide `Permissions-Policy` was also blocking the mic with
`microphone=()` — it's now `microphone=(self)`; if you fork the security
config, keep that.

### 4. Smoke test

Open **Dashboard → Developer → Company Soul**
(`/dashboard/developer-admin/company-soul`) and walk this sequence:

1. **Create:** company name defaults to High Desert Property Management. Fill
   founder name (Craig Bramscher), industry, website. **Start Interview**. →
   Agent greets by first name and opens with a story question (never "what is
   your mission?").
2. **Text turn:** type a 2–3 sentence answer. → One short follow-up, not a
   list of questions.
3. **Voice turn:** click the mic. → The text box is replaced by a **live
   waveform** — bars move with your voice (flat = mic not picking up). Talk,
   click stop. → "Transcribing…" then your words appear and the agent responds.
   (First click triggers the browser mic prompt.)
4. **Compose:** after ≥2 answers, **Generate Soul** (~30–90s, it's 3 model
   passes). → Right panel shows confidence %, per-section coverage grid, gap
   pills, and the markdown. Doc starts with `# <Company> — Company Soul`, then
   `## Identity` (only the facts you entered), then `## Mission & Vision`.
5. **Coverage strip:** the interview panel shows 10 section chips colored
   covered / started / not-yet, plus "N of 10 sections covered" and the answer
   count — this is the "where am I" indicator.
6. **Gap pill → steered interview:** click a missing-knowledge pill (e.g.
   *Hiring philosophy*). → The interviewer pivots and asks ONE story question
   on that exact topic and stays on it. It should NOT say goodbye.
7. **Hallucination check:** the soul must contain ONLY what you said.
   Uncovered sections read *"Not yet captured — continue the interview."*
   Invented facts = bug, flag it.
8. **No-loss regenerate:** note what's in Mission & Vision, answer more
   questions, **Regenerate Soul**. → New version; Mission & Vision (and
   everything else) must still be there — regenerate can add/sharpen but never
   drop. Confidence should move.
9. **Edit:** **Edit** → change a line → **Save as v_N+1**. → Version increments.
10. **Persistence:** reload. → Same interview, transcript, latest soul resume.
11. **Download:** → `HighDesertPropertyManagement.company.soul.md`.

### 5. Prep for Craig's demo

- Smoke-test with a **throwaway** company name (e.g. "Smoke Test Co"), not
  HDPM — the composer merges all interviews with the same company name per
  user, so test answers would pollute (and be re-read into) the real HDPM
  soul forever. Delete test rows from `soul_interviews` / `soul_files` when
  done (cascades clean up turns).
- Test on whatever Craig will present from (his login, his mic, the real URL).
- The demo is the real thing: HDPM, founder interview, talk 20–30 minutes,
  Generate Soul live, then click a gap or two to show the living loop.

---

## Known V1 boundaries (deliberate, not bugs)

- **Push-to-talk, not realtime voice.** Record → Whisper → text loop, with a
  live waveform for feedback. Continuous speech-to-speech is a later upgrade.
- **No spoken replies** — the agent answers in text. (ElevenLabs TTS exists in
  the app if we want voice replies later.)
- **Composer is OpenAI `gpt-4o`** (only provider configured in this repo).
  Swapping to Claude is a one-file change in `src/lib/soul/compose.ts` plus an
  `ANTHROPIC_API_KEY` — worth trying if synthesis quality plateaus.
- **Transcript fetch is unpaginated.** Fine for hundreds of turns; if an
  interview ever exceeds ~1000 turns, add pagination to the compose route's
  `soul_interview_turns` query (Supabase default cap).
- **No knowledge-atom store, no Brain.** Phase 2 (`CompanyBrainBuilder`,
  crawlers, integrations) starts only after the soul demo lands. See the PRD's
  Phase 2 section.
- **Soul scoping is per user + company name** (no team/brand linkage yet).

## Questions for the team discussion

1. Where should the soul live long-term — `soul_files`, or a first-class
   artifact on the brand (next to Brand Identity)?
2. Should Kroids start reading the soul now (inject into their system
   prompts), or wait for the Brain layer?
3. Realtime voice (OpenAI Realtime API) — worth it for the customer-facing
   version, or is push-to-talk + waveform good enough for onboarding?
