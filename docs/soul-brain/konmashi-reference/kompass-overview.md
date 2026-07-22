# Kompass — Konmashi's Agentic Marketing Flywheel

**Branch:** `feature/company-brain` (current) · self-contained and additive — rides on top of the team's SaaS/guardrail work and is removable as one unit. *(The flywheel spine + Market Intelligence originally landed on `feature/agency-agents`; the Company Brain and Reference Library were built on top of it.)*

Kompass is the compass that points a business from a **goal** to the **content that gets them there** — a chain of AI agents, each handing off to the next, backed by a per-brand **Company Brain** so context compounds run over run. For the *why* behind it, see [`why-kompass.md`](./why-kompass.md). This doc has two parts: a plain-language overview to share with anyone, and a technical brief for engineers.

---

# Part 1 — The simple version (share with anyone)

## The idea
Most marketing tools start with "what should we post?" Kompass starts with the **outcome** — e.g. *"onboard 10 new property owners a month"* — and works **backwards** to the plan and the content. And it doesn't guess: every recommendation is **grounded in real, sourced evidence**, not opinions.

Our customers are business owners who don't have time to be marketers (and small agencies running this for many clients). Kompass is their AI marketing department.

## The flywheel — five steps, each an agent
1. **Company Soul** — *Who are we?* An interviewer agent talks with the owner (by voice or text) and turns their answers into a living "soul" document: the company's mission, customers, voice, and hard-won judgment. Context is everything — this is the foundation every other step reads from.
2. **Market Intelligence (Researcher)** — *Who are the customers and what hurts them?* Reads the soul, then goes out and gathers **real, cited evidence**: customer pain points from Reddit and forums, competitor reviews, what people are Googling, and market signals.
3. **Market Brief** — The research is distilled into an evidence-grounded brief: the ideal customers, their pains in their own words, the messages that land, and where to reach them — with a confidence score and a list of what's still missing.
4. **The Plan + Proof (Analyst)** — Kompass writes a marketing/social plan to hit the goal, and **proves it's better** by scoring two versions side by side: one written from just our self-description, one enriched with the market research. The scorecard shows the lift in plain numbers (e.g. *evidence-grounded messaging 41 → 82*).
5. **Push to Konmashi (Producer)** — One click turns the approved plan into a real **campaign** plus a set of **content ideas** inside Konmashi — ready for the content/video pipeline to produce.

## Why it matters
- **Outcome-first, evidence-based.** You tell it the result you want; it does the homework and shows its work.
- **Every brand gets its own brain.** A company can run Kompass for itself *and* for any number of other brands/clients — each one isolated, with its own soul, research, and campaigns. That's the agency model, built in.
- **Business-neutral.** Property management is our first focus (because of the AppFolio integration and ~20K AppFolio customers), but the same engine works for a dentist, a law firm, or a SaaS company — it learns the business from the soul, nothing is hardcoded.

## Where to find it
In the sidebar under **Kompass**: *Company Soul → Market Intelligence → Ideas → Campaigns* — the journey, top to bottom.

---

# Part 2 — Tech brief (for engineers)

## Architecture at a glance
A linear, brand-scoped pipeline that mirrors the proven **Company Soul** pattern at every stage: a session/run table → evidence rows → a **versioned artifact** carrying `confidence` / `gaps` / `coverage` JSONB, produced by a deterministic multi-pass composer, surfaced in a gap-driven UI.

```
Company Soul ──▶ Researcher ──▶ Market Brief ──▶ Analyst (plan + scorecard) ──▶ Producer
 (who we are)   (sourced evidence)  (synthesis)     (baseline vs enriched)    (campaign + ideas)
```

Everything is **scoped to a brand** (`brand_id`), slotting into Konmashi's existing **Team (licensee) → Brand → content** hierarchy. Authorization is route-level via the existing `assertBrandTeamAccess(userId, brandId)` (consistent with `brand_identities` and other brand tables); the routes use the service-role client.

## The pieces

**Company Soul** (foundation, previously merged)
- Mastra interviewer agent + 3-pass composer (`src/lib/soul/compose.ts`); voice via Whisper; versioned `soul_files` with confidence/gaps/coverage; gap-pill re-interview loop.

**Market Intelligence — Researcher + Analyst** (`src/lib/research/`, `src/app/api/research/`)
- **Sources** (`sources/`), each independently fault-tolerant: Gemini Google-grounding, OpenAI web search, **Tavily**, **Reddit** app-only OAuth pain-mining, Google **Places** competitor reviews.
- **Researcher** plans queries from the soul, fans out to the sources, dedupes → sourced `research_findings`.
- **Composer** (3-pass map → compose → score) → versioned `market_briefs`.
- **Analyst** generates `baseline` (soul only) vs `enriched` (soul + brief) plans with identical prompts, then a **scorecard** quantifying the lift → `market_plans`.
- **Reasoning model**: `claude-sonnet-4-6` when `ANTHROPIC_API_KEY` is set (Craig's stack default), else OpenAI `gpt-4o` — centralized in `src/lib/research/llm.ts` (`complete` / `completeJSON`). Search/grounding stays on Gemini/OpenAI/Tavily.

**Brand Soul** (the scoping layer)
- Migration adds `brand_id` (FK → `brands`, additive) + indexes to `soul_interviews`, `soul_files`, `market_research_runs`, `market_briefs`, `market_plans`; backfilled. `user_id` kept as creator, `company_name` as label.
- Soul/MI routes derive `company_name`/`industry` from the brand (+ its `BrandIdentity`) via `src/lib/brand-soul-meta.ts`; a brand selector (sourced from `/api/brand/list`, persisted in `localStorage selectedBrandId`) replaces the old free-text company field on both pages.

**Producer — "Push to Konmashi"** (`src/lib/research/produce.ts`, `…/runs/[id]/produce`)
- Parses the enriched plan into a structured campaign + content-idea seeds (Market Producer agent), then writes brand-scoped rows into the **existing** `campaigns` table (name, objective, description, target audience, platforms, key messages, tags, 30-day window) and the **existing** `ideas` table (calendar seeds, grouped by a generation id). No migration. Generation-job enqueue (mashi prepare jobs) is left as a manual next step.

**UI / nav**
- Market Intelligence rebuilt as a **4-phase tab pipeline** (Outcome → Findings → Brief → Plan) with status-gated tabs and **visual scorecard/coverage bars** (shadcn Tabs).
- New **Kompass** sidebar group: Company Soul → Market Intelligence → Ideas → Campaigns.

## Data model (new tables, all `brand_id`-scoped)
`market_research_runs`, `research_findings`, `market_briefs`, `market_plans` (Supabase migrations, RLS, GRANTs to the API roles). Producer reuses existing `campaigns` + `ideas`. No changes to the team's tables beyond additive `brand_id` columns on the soul/MI tables.

## Keys & deployment
- Research keys (all server-side, optional/fault-tolerant): `GOOGLE_AI_API_KEY`, `OPENAI_API_KEY`, `TAVILY_API_KEY`, `REDDIT_CLIENT_ID/SECRET`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, plus `ANTHROPIC_API_KEY` for Claude reasoning.
- Shipped on `feature/agency-agents`; deployed to a **Vercel preview** via manual `vercel deploy` (the project auto-cancels Git previews via an Ignored Build Step, so CLI deploy is the path). Cloud Supabase is shared with prod; migrations applied via the SQL editor.

## Built since this doc was first written
- **Company Brain** (`docs/company-brain-spec.md`) — the pgvector per-brand memory is live through C3.5: hybrid semantic retrieval, write-back on every run, a nightly self-maintenance "dream" (dedup / contradiction-flagging / salience decay), and a human-in-the-loop clarification queue (the brain asks the owner when unsure). Consumed at **every** stage now, including final post generation (produce + promote).
- **Reference Library** (`docs/reference-library-brief.md`) — viral reverse-engineering engine (v1). Deconstructs a viral video → scores it → templatizes it retargeted to the brand, and **feeds the template back into the brain** as a reusable pattern.

## Deliberately not built yet
- **Closing the loop** — live campaign results flowing *back into the brain* (`kind='outcome'` / a `performance` domain). Blocked on posts publishing + reporting performance; this is the "grown-up Analyst" phase and the keystone that unlocks the cross-brand tiers.
- **Cross-brand pattern tiers** (vertical/horizontal network effect) — gated on resolving the privacy-safe promotion mechanism (the spec's biggest open question).
- **Generation handoff** — auto-enqueuing slide/video jobs from produced ideas; tenant/leasing niche pack; multi-tenant agency dashboard; a deeper "agents visibly working" UX pass.
