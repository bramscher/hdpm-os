# Reference Library & Viral Reverse-Engineering Engine — placement brief

*Parked for deeper design (June 2026). This maps the feature concept onto Konmashi's architecture — **where it resides** — rather than re-specifying the engine. Source concept: `reference-library-feature-brief.md`.*

## The engine, in one line

Save any viral video/post → **deconstruct** it (hook, beat structure, pacing, triggers, CTA) → **score** its viral signals → **templatize** into a fill-in-the-blank skeleton retargeted to the brand. One engine, two avatar modes (small-biz: one ready-to-shoot template; agency: batch + per-client). Build the pipeline natively (a multimodal LLM does the analysis for fractions of a cent); use Higgsfield's free predictor as a **calibration benchmark, not a dependency**.

## Why this isn't "just another input"

A deconstructed reference is **reusable structural knowledge** — the exact shape the brain stores. It threads through three things we've already designed, and strengthens each:

1. **The Company Brain** — it's the richest feeder of the **horizontal (channel/format) tier** of the cross-brand moat. "What hook structure makes a *Reel* hold attention" transfers across every brand doing Reels. Reference Library → horizontal/vertical pattern tiers.
2. **The Producer** — a template ("hook → agitate → payoff → CTA, retargeted to brand") is the scaffold content generation should run into. References become the skeleton for Studio K SLOT_PLANs.
3. **The virality predictor** — we already ship an LLM heuristic (`idea_predictions.predictor='llm_heuristic'`). Scored references + observed metrics + the Higgsfield benchmark are the **calibration data** that turns that heuristic into a grounded scorer. This is the "swap in a real virality model later" seam, filled.

## Where it resides (the layered answer)

| Layer | What lives here |
|---|---|
| **Capture/store** | a new `reference_library` table — saved media + source metadata + the deconstruction JSON + score + template. Brand-scoped, taggable. The billable surface. |
| **Brain knowledge** | each deconstruction ingested into `brand_knowledge` (kind = `reference` / `viral_template`), embedded → semantically retrievable, and **promotable to the vertical/horizontal pattern tiers**. |
| **Producer scaffold** | templates feed the Posts stage / Studio K SLOT_PLANs as structural skeletons. |
| **Predictor calibration** | scores + observed metrics + Higgsfield benchmark tune `idea_predictions`. |

**Verdict:** treat it as a **fourth input channel into the Brain** — alongside Soul, Research, and Outcomes — with its own capture UI/table, but whose real value is in the brain (horizontal-tier feeder) + producer (templates) + predictor (calibration). Not a bolt-on; a keystone.

## Why it fits the moat *and* the privacy model

It maps onto the brain's scoping tiers cleanly and dodges the privacy problem we flagged for cross-brand learning: viral references are **public by nature**, and what promotes up the tiers is the **de-identified structural pattern** ("2-second visual-shock hooks lift hold-rate on Shorts"), never a brand's private data. So this is arguably the **cleanest, highest-signal source** for the lane-level network effect — more customers → more deconstructed references in a lane → a smarter format playbook for everyone in it.

## Deconstruction schema

Use the v1 JSON from `reference-library-feature-brief.md` (source, hook, beat-by-beat `structure[]`, pacing, audio, emotional_triggers, cta, `virality_score`, `template`). When ingesting into the brain, the embeddable `content` is the hook + beat labels + why-it-works + template skeleton; provenance = source URL/creator; metadata = platform, observed metrics, scores.

## Sequencing & open decisions (for the deeper pass)

**Sequencing:** capture + deconstruct + template can **ship standalone first** (own table + UI); brain ingestion + tier promotion follow once the Company Brain's base store exists (it ingests into the same `brand_knowledge`). Predictor calibration is a later, data-dependent step.

**Open questions (from the source brief, still live):**
1. Platforms first — TikTok + Reels + Shorts, or include X?
2. Scorer day-one, or ship deconstruct + template first and add scoring v2 after calibration?
3. Model — cheap Flash-tier for unit economics, or top-tier for launch quality?

**First concrete step (when we pick this up):** a calibration run — feed one real viral clip through both the proposed deconstruction prompt and the connected Higgsfield predictor, compare, and lock the v1 schema + scoring weights.

## Where it fits the flywheel — v1 built (2026-06-26, branch `feature/reference-library`)

A working v1 is in the codebase. It slots in as a **standalone input that feeds the content side of the flywheel**:

```
Reference (URL + transcript/scene notes)
   → Deconstruct (hook · beats · pacing · triggers · CTA)
   → Score (virality 0–100; calibratable vs Higgsfield)
   → Templatize (proven structure rewritten for THIS brand, using the Brand Soul)
        ↘ feeds → Create Posts (Producer): a template is a content scaffold
        ↘ feeds → the virality predictor (idea_predictions): grounded score upgrade
        ↘ feeds → the Company Brain (later): kind=reference/viral_template, horizontal-tier
```

So in flywheel terms it's an **alternate on-ramp into the "Create Posts" stage** — instead of generating ideas only from the plan, you can generate brand-retargeted content from a *proven* viral structure. It already consumes the Brand Soul (the same substrate the rest of the flywheel uses) to retarget the template.

**v1 build (this branch):**
- `supabase/migrations/20260627120000_reference_library.sql` — the `reference_library` table (apply via SQL editor).
- `src/lib/reference/deconstruct.ts` — the LLM deconstruction → score → brand-retargeted template engine (text-driven; reuses `completeJSON`).
- `POST/GET /api/reference-library` — deconstruct + save + list. Deconstruction returns even before the table exists (save is best-effort), so the engine is demoable immediately.
- `src/app/dashboard/reference-library/page.tsx` + Kompass nav entry.

**v1 scope (revisit per the open questions):**
- **Multimodal — Gemini watches the video** (`gemini-2.5-flash`, native video). For a YouTube URL it fetches + analyzes the clip directly (no transcript, no download), capturing the *visual* hook / on-screen text / pacing. Falls back to: toolkit caption fetch → text deconstruct → manual transcript. *(TikTok/Reels: download-the-clip-to-Gemini is the next step.)*
- **Transcript fetch** uses the Hangten toolkit (`HANGTEN_TOOLKIT_API_KEY`), so it works on serverless.
- **Scorer on from day one** (LLM heuristic, same family as the P3 `idea_predictions` predictor); Higgsfield calibration is the tuning step.
- **Same engine for both avatars**; the small-biz "one template" output shows first.

**Planned next — standalone capture + email-in (Craig, 2026-06-26):**
Make the Reference Library a **standalone capture front-end** (capture from anywhere, not just inside a brand run) and add an **email-in ingestion path**: a user emails a video URL to a Konmashi inbox (e.g. `library@…` / a per-brand alias) → an inbound handler parses the URL → deconstructs it → adds it to that brand's reference library automatically. Lets people index inspiration the moment they see it, from their phone, with zero app friction. Implementation sketch: inbound-email webhook (e.g. a mail provider / SendGrid Inbound Parse / a `/api/reference-library/inbound` route) → resolve sender → brand → enqueue the same deconstruct pipeline. Auth/allowlist by sender domain or a per-brand secret alias.

## Relationship to other work
- [[konmashi-flywheel-build-state]] — the flywheel this feeds.
- Company Brain spec (`docs/company-brain-spec.md`) — the home for the `reference`/`viral_template` knowledge kind and the horizontal-tier promotion this powers.
