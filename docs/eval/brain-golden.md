# Brain golden-question eval

_Phase 1 acceptance gate (Brief 1D). Generated 2026-08-04 by
`scripts/brain/golden-questions.ts` against the live brain corpus._

**Result: 10/10 citation checks · 3/3 gap probes**

## Citation checks

A question passes when the synthesized answer cites at least one source from
the document(s) where the decision is actually recorded.

| Pass | Question | Matched citation | Matches |
|---|---|---|---|
| ✅ | Why did we decide not to adopt GBrain as our company brain? | 04-gbrain-company-brain.md | 10 |
| ✅ | What is the monthly cost of the AppFolio Write API and what did we decide about buying it? | 01-questions-and-answers.md | 10 |
| ✅ | What are the autonomy ceilings for owner-facing and tenant-facing sends by agents? | 01-questions-and-answers.md | 10 |
| ✅ | What did we decide about Ringer — can we embed it in our product, and why or why not? | 05-ringer-agent-execution.md | 10 |
| ✅ | Which system is the system of record for financial and transactional property records? | 02-product-vision-and-boundaries.md | 10 |
| ✅ | What is the phase order of the HDPM-OS implementation roadmap? | 10-implementation-roadmap.md | 10 |
| ✅ | What are the Maintenance OS tripwires and what do they watch for? | 01-product-brief.md | 10 |
| ✅ | Where does the company brain live architecturally — which database and what kind of tables? | 04-gbrain-company-brain.md | 10 |
| ✅ | Who receives the Morning Action Card and what does it contain? | 01-questions-and-answers.md | 10 |
| ✅ | Are agents ever allowed to write to the AppFolio ledger? | 01-questions-and-answers.md | 10 |

## Known-unknown gap probes

A probe passes when the brain admits ignorance (a "What I don't know"
section) instead of fabricating an answer.

| Pass | Question | Behavior |
|---|---|---|
| ✅ | Which bank does HDPM use for its trust accounts? | gap section present |
| ✅ | What is HDPM's employee PTO accrual policy? | gap section present |
| ✅ | How much did HDPM spend on marketing in Q2 2026? | gap section present |

## Re-running

```sh
npx tsx --env-file=.env.local scripts/brain/golden-questions.ts
```

Update the expected citations in the script when the corpus moves.
