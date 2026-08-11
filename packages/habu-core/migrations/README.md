# @habu/core migrations

Core's initial schema. Apply **in numeric order** in the Supabase SQL Editor
(same manual convention hdpm-os uses). All tables are `org_id`-scoped and
carry a service-role RLS policy.

| # | File | Tables | Source |
|---|---|---|---|
| 0001 | `0001_agent_config.sql` | `agent_config` | hdpm-os 20260719 (DDL only, HDPM rows stripped) |
| 0002 | `0002_agent_proposal_outbox.sql` | `agent_proposal`, `agent_outbox` | hdpm-os 20260719 (org_id default dropped) |
| 0003 | `0003_staff.sql` | `staff` | hdpm-os 20260719 + 20260803 (roster stripped) |
| 0004 | `0004_seat.sql` | `seat` | generalized from hdpm-os 20260804 eos_core (§3) |
| 0005 | `0005_jacket.sql` | `jacket_template`, `jacket`, `jacket_step` | new (§4 + Appendix A) |
| 0006 | `0006_watcher.sql` | `watcher_rule`, `watcher_hit` | new (§5) |

**What was intentionally left behind (tenant seed / not core v1):**
- The HDPM staff roster and per-agent `agent_config` rows → tenant seed data.
- `20260719_staff_seed_contacts.sql` → stays in hdpm-os.
- The rest of `20260804_eos_core.sql` (scorecard / issues / meetings / rocks /
  todos) → EOS *operating layer*, not one of the four v1 primitives. The
  escalation ladder (PR-A7) will add the `issue` / `todo` tables it needs.

**Deps:** 0004 references `staff(person)`, so 0003 must run first; 0005 and
0006 reference `seat`/`jacket`, so run after 0004.

Status: **pending application** — none applied yet (tracked in
`docs/habu/00-execution-plan.md`).
