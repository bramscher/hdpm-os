# Shared maintenance chasers — trial rollout

September 21, 2026. Implementation and local verification complete. Production configuration, migrations, Slack identity checks and trial delivery are pending; no new messages have been sent.

## What the trial does

Penny (`penny@highdesertpm.com`) and Craig (`craig@highdesertpm.com`) share the maintenance follow-up section on `/company/issues`. Work & Billing links to the same page. Other staff retain the existing Company Issues experience.

The initial queue covers overdue estimates/recorded owner approvals, new work needing assignment, and assigned work lacking a service date. Source thresholds are reused. Completion/billing chase categories are a later extension.

Each item has work description, source status/clock, HDPM owner, vendor, assigned technician, next action/review date, sync timestamp, and linked estimate amount/version when one exists. Missing amounts and owner contacts remain unknown. An “Estimated” status alone is an internal decision task, not an owner-approval send.

Both reviewers receive up to seven actionable work-order cards plus one daily summary. Work-order cards are updated in place and can be discussed in their Slack threads; the daily summary shows the selected items and links to the full queue. A cron retry updates existing messages instead of posting duplicates. Daily delivery is scheduled for 8 AM Pacific on weekdays, with UTC schedules covering daylight saving changes.

Slack Review email / Review text opens an editable modal with the exact outbound message, recipient and configured sender. Approval is explicit. Update / snooze supports a call/reply note, next review date, reassignment, requesting help, stopping/reopening a chase, and checking uncertain delivery. The website uses the same action service and database version. Saving a website action refreshes Company Issues; while not editing, the queue polls every 30 seconds for Slack changes.

Sends remain waiting for a reply; they do not close work orders. Unknown delivery cannot be retried until checked. New source episodes resurface for review without erasing history. Request help links into an existing active EOS escalation or creates one; it never solves an EOS issue. Field-owner reassignments update the work order and record an audit event.

## Verified locally

- 988 tests across 96 files passed, including shared-send guards, Slack modal/card behavior, retry dedupe and candidate thresholds.
- 31 PGlite database checks passed, including upgrade repeatability, scoped reviewer access, optimistic versions, uncertain delivery, business-day/DST dates and audited reassignment.
- Production webpack build and TypeScript checks passed.
- Authenticated live UI and Slack round-trip verification remain pending production access. Automated checks do not prove production sender authorization or delivery.

## Production setup

1. Complete `npx vercel login`. The saved login returned `not_authorized` during this session.
2. In a clean project checkout, link to the existing `hdpm-chatbot` project in `bramplan`, then export production configuration to a protected temporary env file. Never add credentials to Git.
3. Apply these additive migrations through the existing HDPM Supabase administration connection, in order:
   - `supabase/migrations/20260920_estimate_followup_review.sql`
   - `supabase/migrations/20260921_shared_maintenance_chasers.sql`
   Neither migration activates outbound sending. The second scopes review actions to active Penny/Craig staff identities without changing their roles.
4. Run `node scripts/preflight-maintenance-followups.mjs /private/tmp/hdpm-chasers.env`. Check both staff/Slack identities, schemas, next-review function, sender identities, preview switches and Slack authentication. Review Zoom authorization as well; configured credentials alone do not prove SMS delivery. Keep any unavailable channel disabled.
5. Deploy the tested branch to production and verify Vercel success. Confirm that Penny and Craig see Maintenance follow-ups on Company Issues. Existing source records are read only until a reviewer acts.
6. Run `node scripts/trial-maintenance-followups.mjs --env=/private/tmp/hdpm-chasers.env` for a read-only preview. Inspect actual candidates, source freshness and message wording. Source data older than two hours blocks external sends. Historical Outlook drafts are not treated as sent; reviewers must check current conversations.
7. Once preflight and preview pass, apply `scripts/activate-maintenance-followups.sql`. It audits the prior settings, disables legacy chase actions, retires queued legacy messages and enables the shared trial. Allow any previously running legacy invocation to finish before the first shared send; inspect recent/uncertain provider activity. New sends check recent legacy delivery/cooldown too.
8. Run `node scripts/trial-maintenance-followups.mjs --env=/private/tmp/hdpm-chasers.env --publish` to send only the internal Penny/Craig Slack cards. This does not send any vendor/owner follow-up. Verify both DMs and their review modals; choose one real eligible follow-up and have a reviewer approve it.
9. Verify one provider message, recorded result, both Slack cards, and Company Issues. Check that a second/stale approval is rejected. Recheck the next 8 AM summary before relying on the schedule.

## Operational notes

- Standard snooze/cooldown: three business days, reviewed at 8 AM Pacific. Staff can choose a different future review date when recording an outcome.
- Do not remove preview flags merely to make a failing sender appear available. Verify the actual sending email/Zoom account first.
- An uncertain initial Slack post is deliberately retained without retry; inspect Slack/provider history and the `maintenance_followup_slack` delivery row before repairing it.
- A failed Slack card refresh does not undo a send. The database history and stale-version guard remain authoritative; the next refresh uses current state.
- All routine items stay in the maintenance section. Only Request help promotes an item to the EOS issue queue; existing legacy escalations remain visible.
- To pause the new trial, disable `estimate_chaser/team_review` or use the global kill switch. Activation disables the legacy send actions, so pausing the new trial does not intentionally restart them. Restore old settings only through a deliberate rollback reviewed against the activation audit record.

## Production verification — September 21, 2026

Vercel sign-in verified as bramscher. Both chaser migrations were applied successfully through the HDPM Supabase SQL editor; service-role reads verified both tables and the business-day function. Penny and Craig are active with Slack mappings. The shared-review configuration remains disabled.

Main already contains the implementation through 61ac894/65b6717; current main at verification was ece3966. No older branch was deployed over that work. The live authenticated Company Issues page and authenticated cron preview both returned 167 candidates. The first seven cards show source sync dates from May–July 2026. Check source freshness and current AppFolio status before activating daily Slack delivery or selecting a real outbound trial.

Vercel exports SLACK_BOT_TOKEN as [SENSITIVE]; the local invalid_auth result is from that placeholder, not proof that the deployed token is invalid. Production Slack authentication and modal round trip remain unverified. Existing preview flags remain unchanged. No internal Slack cards or external follow-ups were sent during this verification.
