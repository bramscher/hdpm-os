# HDPM-OS — Open Questions

> Status: exploration draft, 2026-08-03. Grouped by how each question gets
> resolved. Cross-references in parentheses.

## A. Resolvable by inspecting code (next working sessions)

1. Is `.env.local` (present in working tree) fully gitignored across history,
   and does anything in git history need rotation? (doc 01 §9.8)
2. Exact current state of the RAG-core schema (knowledge_chunks RPC
   definitions) in the live Supabase — dump and capture as migrations.
   (doc 01 §4)
3. Which tables besides the agent set already carry `org_id`/RLS, and the
   cheapest path to the RLS-on-new convention for CRM/EOS tables. (doc 08)
4. Does the AppFolio leads webhook payload carry enough attribution
   (source/campaign) for pipeline source-attribution, or does that need the
   Reports API guest-card feed? (doc 07 §3)
5. GBrain calibration appliance effort: how long does a pinned-release PGLite
   install + SOP-corpus load actually take? (doc 04 §2 — timebox: half a day
   or drop it)
6. Whether Next 16 + Auth.js v5 + React 19 upgrade can land as one Phase-0
   brief or needs splitting. (doc 08 §8.1)

## B. Requiring business decisions (Craig / leadership)

1. **Cadence reality check:** does HDPM want a real weekly L10-style meeting,
   or a lighter huddle? Who facilitates? (doc 06 §10 — the ASSUMPTION)
2. **Seats:** confirm the accountability chart seats/roles seed (from the
   Notion roles doc) and who owns which scorecard metrics/Rocks. (doc 06 §3)
3. **Phase order:** brain→EOS→CRM as recommended, or CRM first for
   owner-lead revenue? (doc 10 sequencing note)
4. **Owner-acquisition pipeline stages + lost reasons** — the doc 07 defaults
   need a 30-minute review against how Craig actually sells.
5. **Sep-4 write-path decision** (already scheduled): Write API vs AppFolio
   MCP vs keep retyping — feeds Phase 5. (agent-os Q5)
6. **Brain capture norms:** is the team comfortable with 📌-pinned Slack
   capture and meeting summarization? Announce and opt-in per channel.
   (docs 04 §4, 05 §5)
7. **Repo rename timing** (`hdpm-chatbot` → `hdpm-os`). (doc 02 §5)
8. **Budget posture** for the execution layer's per-run/monthly caps.
   (doc 05 §3.5, Q5 pattern)

## C. Requiring vendor / API confirmation

1. **AppFolio MCP**: specs, pricing, timeline, and whether it supports
   unattended service use — the standing Phase-0 verification item.
   (agent-os)
2. **Rentzap**: does any webhook/status API exist for application/screening
   *status* (not data) to flip leasing stages automatically? (doc 07 §4)
3. **Zoom Phone**: call-summary/transcript API availability on HDPM's plan
   for CRM activity capture (call *records* are proven; summaries are not).
   (doc 07 §2)
4. **Haven**: webhook (vs poll) confirmation for real-time leasing capture —
   standing item from agent-os Q4.
5. **Graph**: ApplicationAccessPolicy expansion process for additional
   mailboxes (per-mailbox consent flow). (doc 08 §3)
6. **Supabase**: pgvector HNSW + RLS recall behavior at our scale if/when an
   authenticated-client path lands (the soul-brain caveat). (doc 04 §3)

## D. Involving legal / employment / privacy / regulatory advice (flag, don't self-answer)

1. Retention requirements for applicant-adjacent records (even status-only)
   under Oregon law and fair-housing rules — before the leasing pipeline
   ships. (doc 07 §4)
2. Whether meeting recording/transcription requires consent notices under
   Oregon two-party rules for any call that includes non-staff. (doc 06 §4)
3. Employee-data boundaries: what may an onboarding/offboarding checklist
   legitimately store; confirm the "no HR records" line with counsel/HR
   practice. (docs 07 §6, 08 §1)
4. Delinquency/notice workflow: which steps must remain human-served under
   ORS 90, and template review. (doc 07 §6)
5. Any data-processing terms owed to owners for AI processing of
   owner-financial summaries (management-agreement review). (doc 08 §7)

## E. Explicitly unverified in this exploration (honesty list)

- All GitHub metrics (stars/issue counts) were read from fetched pages, not
  the API-verified in every case; magnitudes are right, exact counts may
  drift.
- GBrain's benchmark claims and "zero-leak" security are self-reported
  upstream; we did not run it.
- Ringer's ~$0.01/task cost claim is the author's; unverified.
- Whether FounderOS-DEMO screens look good in practice — we did not run it
  (it is trivially runnable if a design pass wants references).
- The soul-brain P@5 0.68 baseline comes from the Konmashi reference
  implementation, not this repo — treat as directional for our corpus.
