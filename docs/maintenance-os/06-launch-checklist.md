# Wave 1 Launch Checklist — Action Items for Craig

Status as of **2026-07-02**, branch `feature/maintenanceOS` (pushed to GitHub).
Everything below the "Done" line is built, unit-tested (98/98), and verified against the live DB.

## ✅ Done (no action needed)

- All three migrations applied to the live Supabase DB (by Craig, 2026-07-02):
  `20260520_inspection_candidate_columns`, `20260702_maintenance_os`, `20260702_maint_digest_recipients`
- Sync verified live: 308 WOs / 524 vendors synced twice; hand-set workflow fields
  (stage/owner/priority) **survive re-sync** with stable row ids — the old
  delete-then-insert is gone
- Tripwire engine verified live: 914 exceptions, 0 rule errors
- Pre-existing cron bug fixed (Vercel cron sends GET; routes only auth'd POST —
  the 8AM work-order sync and KPI snapshot crons had been silent no-ops)
- Dashboard at `/maintenance/board` (7 views per the mockup) + WO detail page with
  closure-gate checklist; "Maintenance" in the sidebar

## 🔲 Action items (in order)

### 1. Decide: grandfather-close the historical backlog
The live tripwire run found **634 old AppFolio-completed WOs stuck in VERIFY**
(they predate the system — nobody will retroactively add photos/time/materials)
and **280 in NEW** (the expected one-time triage backlog). Until cleared, the
Exceptions view is too noisy for Cheryl's daily sweep.

- [ ] Pick a cutoff date (suggested: completed before **2026-07-01**)
- [ ] Ask Claude Code for the one-time grandfather SQL (bulk `stage='CLOSED'`,
      actor `system:backfill`, gate bypassed by design) — **do not** hand-close
      634 items through the UI

### 2. Resend (email digests)
Everything else works without this; digests silently skip until it's done.

- [x] Create a Resend account / API key (resend.com) — done 2026-07-02, key tested valid
      (account: cab@wellifi.com)
- [ ] Verify the `highdesertpm.com` sending domain in Resend — **blocks all digest
      sends**: resend.com/domains → Add Domain → add the DKIM/SPF DNS records →
      Verify. Tested 2026-07-02: sends from maintenance@highdesertpm.com return
      403 until this is done
- [ ] Confirm `RESEND_API_KEY` is in Vercel env vars (it's in local .env.local)
- [ ] (Optional) `MAINT_DIGEST_FROM` if you don't want the default
      `HDMS Maintenance <maintenance@highdesertpm.com>`

### 3. Opt people into digests (in the app, not env vars)
- [ ] As an admin, open **Maintenance → Exceptions → "Digest recipients"**
- [ ] Enter emails for Cheryl, Alberto, Penny, Jen (+ anyone else) and tick "enabled"
- [ ] Digests go out weekdays 6 AM PT, one email per person, only THEIR items,
      nothing on a clean day

### 4. Merge & deploy
- [ ] Open the PR: https://github.com/bramscher/hdpm-chatbot/pull/new/feature/maintenanceOS
- [ ] Merge to `main` → Vercel auto-deploys; the new cron schedules
      (15-min sync, weekday tripwires, Monday unbilled report) activate on deploy

### 5. Adoption week 1
- [ ] Cheryl: one-time triage pass — the ~280 NEW WOs each need priority (P1–P4),
      a stage, and a real next-action date (the backfill defaulted everything to
      owner=Cheryl, date=next business day)
- [ ] Cheryl: vendor roster cleanup — 524 AppFolio vendors are seeded; fill in
      profiles (trades, insurance, W-9, preferred) via **Vendor Scoreboard → Edit**;
      ranking improves as profiles + assignments accumulate
- [ ] Confirm AppFolio's exact work-order status vocabulary with Cheryl — if she
      uses statuses beyond Open/In Progress/Completed/Canceled/Closed, tell Claude
      Code so `mapWorkOrderStatus` (lib/appfolio.ts) can map them
- [ ] Goal: Exceptions view at ZERO for 5 consecutive business days = Phase-1 done

## 🔒 Gated on the Sep 4, 2026 decision (build vs. Jobber vs. Realm-X)

Do **not** start these without an explicit go:
- Wave 2: dispatch queue, vendor accept/decline magic links, owner-approval
  magic links, scope-change flow, route-optimization reuse
- Wave 3: tech PWA, scheduling UI, tenant notifications (Haven overlap decision),
  QBO cost sync

## Known limitations (by design, Wave 1)

- Tripwires **#1** (Haven log diff) and **#9** (tenant ping follow-up) are stubs —
  no Haven.AI API access yet; closure-gate condition 4 is a manual
  "tenant ping sent" checkbox on the WO detail page
- Vendor acceptance (#4) is marked manually after a phone call (magic links = Wave 2)
- Rule 7 "docs" are thin: photos = timeline photo events; time/materials = linked
  invoice line items
- The `MAINT_DIGEST_RECIPIENTS` env var still works as a fallback but the in-app
  panel is the intended path

## Quick reference

- Spec: `docs/maintenance-os/` (00–05) · this checklist: `06-launch-checklist.md`
- Tests: `npm test` (98) · Board: `/maintenance/board` · Detail: click any card
- Tripwire dry run: `GET /api/maintenance/cron/tripwires?dryRun=1` with
  `Authorization: Bearer $CRON_SECRET`
