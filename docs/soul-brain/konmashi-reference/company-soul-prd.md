# PRD: Company Soul Interview Agent (V1)

**Branch:** `feature/company_soul`
**Author:** Craig Bramscher (with Claude)
**Date:** June 9, 2026
**Status:** Direction locked — pre-build

---

## One-sentence direction

> Build a single Interview Agent whose job is to extract a company's tacit knowledge and create a living `company.soul.md` artifact. Then use that artifact as the seed crystal for a continuously evolving Company Brain that powers every future Konmashi agent and workflow.

One interviewer. One soul. One brain. Everything else grows from there.

## Thesis

Most founders cannot articulate the tacit knowledge in their heads. Their most
valuable expertise has been compressed into automatic judgment they can no longer
narrate. Forms hide that knowledge. Stories reveal it.

So the first agent a Konmashi customer meets is not a content creator. It is an
interviewer — a patient, persistent journalist whose sole purpose is extracting
what the company already knows and turning it into the context layer every
downstream Kroid consumes.

Generation is becoming a commodity. Understanding isn't. The quality of every
Konmashi output is directly proportional to the quality of this understanding.

## The two artifacts

| | `company.soul.md` | `company.brain` |
|---|---|---|
| Question it answers | **Who are we?** | **What do we know right now?** |
| Metaphor | Constitution | Memory |
| Change cadence | Quarterly / annually | Daily |
| Created by | Interview Agent (V1 — this PRD) | Brain Builder (Phase 2 — out of scope) |
| Contains | Origin story, mission, vision, values, customers, products, brand voice, decision frameworks, competitive positioning, founder philosophy | Website crawl, blogs, videos, PDFs, SOPs, CRM, Drive docs, AppFolio data, social content, customer feedback, future interviews |

The Soul is the seed crystal. The Brain grows around it later. **V1 builds only the Soul.**

## Product goal

Transform founder knowledge into `company.soul.md` through a voice-first
conversational interview.

## Demo success criteria

```
Craig clicks Start Interview
Craig talks for 20–30 minutes
Transcript saved
Soul Composer runs
HDPM.company.soul.md appears
Everyone says: "That is exactly HDPM."
```

A new employee, marketer, consultant, or AI agent can read the generated Soul
and understand the business in under 15 minutes.

## User experience

Not forms. Not a wizard. Not questionnaires. Literally ChatGPT Voice.

```
Welcome to Konmashi.

Before we create content, I'd like to understand your company.

Press Start.
```

The agent opens with a story question, the founder talks, the agent listens and
asks follow-ups exactly like a good journalist. Sessions are resumable across
days. After enough material exists:

```
Company Soul Generated

Confidence: 78%

Missing Knowledge:
- Hiring Philosophy
- Competitive Threats
- Customer Retention Strategy

Continue Interview?
```

The gap report is not a separate product surface — it is simply what the
interviewer says when the soul has holes. It makes the interview living: the
onboarding never really ends.

### Voice requirements

- Voice-first input (push-to-talk / press-record), text as fallback
- Live transcript visible while talking
- Follow-up questions and interruptions supported
- V1 implementation: browser MediaRecorder → server-side Whisper transcription
  → text agent loop. (Realtime speech-to-speech is a later upgrade, not a V1
  requirement.)

## Interview philosophy

Do not ask form questions. Ask founder questions.

| Never ask | Ask instead |
|---|---|
| "What is your mission?" | "Why did you start (or buy) this company?" |
| "What are your values?" | "Tell me about a customer situation that made you proud." |
| "What makes you different?" | "Why do customers choose you instead of competitors?" |

Behavioral rules for the interviewer:

- One question at a time. Follow the thread before moving on.
- Hunt stories: stories contain the tacit knowledge.
- Notice contradictions and gently probe them.
- Extract beliefs, principles, and decision frameworks from offhand remarks
  (e.g. "because we've always done it that way is not a reason" is a **value**,
  not a sentence).
- Never re-ask what is already known; deepen instead.

### Founder-first opening arc (first session)

The company doesn't know itself — the founder does. The first interview targets
founder knowledge:

1. Why did you buy/start this company?
2. What did you see that others missed?
3. Why does [their obsession — e.g. maintenance] matter so much to you?
4. What lessons from past ventures still guide you?
5. What makes a great employee? A terrible one?
6. What do customers consistently misunderstand?
7. What kind of company are you trying to build?
8. If this succeeds beyond your expectations, what does it look like in 10 years?

### Coverage map (sections the soul must eventually fill)

1. Origin Story
2. Customers (ideal, bad, pain points, success stories)
3. Products & Services
4. Decision Frameworks
5. Operations & operating rhythm
6. Culture & values
7. Brand voice
8. Competitive positioning
9. Future

Confidence % = weighted coverage of these sections. Missing/thin sections feed
the "Continue Interview?" prompt.

## Architecture

Product framing: **one agent**. Implementation: one conversational agent plus
deterministic pipeline steps (the composer and scorer are generation/scoring
steps, not autonomous agents).

```
Founder (voice)
      ↓
CompanySoulInterviewer  (Mastra agent — conversation, follow-ups, memory)
      ↓
Transcript (persisted per turn)
      ↓
Soul Composer           (generation step: transcript → company.soul.md)
      ↓
Coverage / Gap scoring  (confidence % + missing-knowledge list)
      ↓
company.soul.md         (versioned artifact)
```

### Fit with the existing codebase

- **Mastra is already integrated** (`src/mastra/`, `@mastra/core`, PG-backed
  memory via `MASTRA_MEMORY_DATABASE_URL`). The interviewer is a new agent in
  `src/mastra/agents/`, registered in `src/mastra/index.ts`.
- **Pattern to copy:** `business-assessment-agent` + its chat route
  (`api/business-assessment/agent/chat`) — per-thread persisted messages,
  Mastra memory thread, history replay. The Soul Interviewer is the same
  machinery with the opposite philosophy (stories, not fields).
- **Voice:** new thin `/api/soul/transcribe` route using the OpenAI Whisper API
  (`OPENAI_API_KEY` already in `env.ts`). The existing YouTube whisper route is
  video-pipeline-specific and not reusable.
- **Models:** interviewer on the existing OpenAI setup; the Soul Composer is
  where quality is the demo — use the strongest available model for synthesis.

### Storage (V1 — deliberately dumb)

No graph database. No vector database. No fancy memory. Store JSON. Ship.

```
soul_interviews        (id, user_id, company_name, status, created_at)
soul_interview_turns   (id, interview_id, role, content, created_at)
soul_files             (id, user_id, file_name, version, content, confidence,
                        gaps jsonb, source_interview_ids jsonb, created_at)
```

(Optionally `soul_insights` for extracted knowledge atoms if a live insight
panel is wanted in the demo UI; not required for the core flow.)

### API surface

```
POST /api/soul/interviews              create / resume an interview
POST /api/soul/interviews/[id]/chat    one conversational turn
POST /api/soul/transcribe              audio blob → text (Whisper)
POST /api/soul/compose                 transcript(s) → versioned company.soul.md
GET  /api/soul/files                   list soul versions
```

### Demo UI

`/dashboard/soul` — two panels:

- **Left:** voice-first chat. Press Record → talk → live transcript → agent
  follow-up.
- **Right:** Soul status — coverage by section, confidence %, missing
  knowledge, **Generate Soul** button, markdown preview + download of the
  latest `company.soul.md`.

## V1 non-goals

- No multi-agent orchestration
- No vector search / knowledge graph
- No website crawler, Drive/OneDrive import, CRM or AppFolio connectors
- No content generation (no video, social, blogs, Canva, Remotion, Veo)
- No workflow automation or social publishing

Only produce an exceptional `company.soul.md`.

## Phase 2 (directional, not specced): Company Brain

`CompanyBrainBuilder` continuously enriches knowledge around the Soul: website
crawl, document imports, integrations, ongoing interviews. The Soul stays the
constitution; the Brain is the growing memory. Every Kroid reads both. This is
where "Konmashi understands my company better than any competing AI" becomes
the moat — but none of it is built until the Soul demo lands.

## First test subject

HDPM. The existing draft `HDPM.company.soul.md` (v1, ~70% complete) is the
benchmark: the demo must extract the pieces it explicitly lacks — why Craig
bought HDPM, why maintenance matters, the Brammo lessons, the founder
philosophy — and produce a soul that reads as unmistakably HDPM.
