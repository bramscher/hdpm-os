# Maintenance chasers — planning brief

Date: September 21, 2026. Status: implemented for the Penny/Craig trial; local checks passed, production activation pending. See [trial rollout](../maintenance-chasers-rollout.md).

Craig requested a simpler work-order and estimate chase workflow with enough context to act, visible in Slack and Company → Issues & To-Dos. Craig approved trying this extension to the older Loop 1 plan. This document does not itself enable outbound messages.

## Recommended experience

One shared maintenance follow-up queue, visible on `/company/issues` and summarized by Dez in Slack. Work & Billing links to the same queue. Reuse the existing estimate follow-up review work rather than launching a third independent queue.

On Company Issues, show a Maintenance follow-ups section with Needs action, Waiting, and Needs help filters. Keep the existing company Issues and To-Dos available. Routine follow-ups remain operational records; only escalations become EOS issues. Every maintenance follow-up is still accessible on this page.

Default to the signed-in person's items with an obvious All team option and total backlog count. Missing owners appear prominently for the coordinator. Each row has one accountable HDPM staff member, one primary next action, and a due date. Group multiple reasons under one work-order card while retaining their separate evidence/history.

## Information to show

| Always visible | Expanded detail |
| --- | --- |
| WO number, property/unit, concise work description | Full work description and source links |
| Actual source status and why this needs action | Status history; distinguish AppFolio status from local workflow stage |
| HDPM responsible person; vendor/technician | Available vendor business contact information and contact source |
| What/who we are waiting on | Approval request, decision-maker and approval evidence, if recorded |
| Age in this step; next-action date; missed visit date when relevant | Total WO age, date calculations and prior appointments |
| Last confirmed follow-up and outcome | Actor, channel, recipient, exact message and delivery state for each attempt |
| Next recommended action | Editable proposed follow-up, notes, scope and estimate link |
| Estimate amount when a linked estimate supplies one | Amount source, version and date; unknown shown explicitly |
| Data last synced | Source errors or stale-data warnings that affect actionability |

Use plain language such as Waiting on vendor bid, Needs a scheduling date, Owner decision requested, or Completion needs confirmation. Never label an estimate as owner-pending solely because AppFolio says Estimated. Draft prepared, message sent, provider delivery, recipient reply, and work resolved are distinct facts.

## Initial chase coverage

Use the shared maintenance dashboard thresholds as the starting rules, with emergencies and explicit overdue next-action dates taking precedence:

- New work without assignment: more than one business day.
- Assigned but unscheduled work: more than five business days.
- Vendor estimate requested: more than three business days in that step.
- Estimate received: review who needs to decide; chase that person only when the responsibility is known.
- Recorded owner-approval request: more than three business days without a decision.
- Scheduled visit date passed: confirm whether work happened before assuming it did not.
- Waiting or work completed without closure/billing: existing five-calendar-day rules; route the action to the responsible party.

Start with estimate and scheduling follow-ups, then extend the same queue to completion/billing follow-ups after the first workflow is accepted. Show the broader categories in the plan, not as already-enabled automation.

## Staff actions

Primary: Review follow-up. Open one detail view with source context, message draft, channel and recipient.

Supporting: record contact/reply; choose next-review date; reassign responsibility; request help; mark follow-up no longer needed with a reason. Distinguish recording a call from sending a message. An internal Send button must state whether it sends email or SMS and identify the recipient.

Sending a follow-up moves it to Waiting, not Done. A missing phone/email becomes a contact task. A new eligible episode can reopen a resolved follow-up while preserving the old history. AppFolio remains the source for external work-order state. Resolving a follow-up must not silently close a work order or solve an EOS issue.

## Slack

Initial reviewers confirmed by Craig: Penny (`penny@highdesertpm.com`) and Craig (`craig@highdesertpm.com`). Proposed initial delivery is a Slack DM to each, resolved through the staff identity map; no channel was named. Each can act on the same shared queue.

Proposed cadence: one weekday morning summary after source sync, containing totals, up to seven actionable items, and a link to the full queue at `/company/issues`. Show the remaining backlog count so the display cap never hides work.

Each item shows property/unit, WO number, short description, waiting reason, age, HDPM owner, last confirmed contact and next action. Expand into one ongoing thread per work order when discussing the item. Reply in the existing thread for meaningful changes; do not create repeated copies each morning.

Confirmed first-release scope: review, edit, and approve outbound follow-ups directly in Slack. Review opens a Slack modal showing the exact message, channel, sending identity, recipient and work-order context. Explicit Send email / Send text submits the reviewed version. Snooze and next-action changes use the shared action API. After either reviewer acts, update both reviewers' cards and Company Issues; a stale second approval must not send again. Staff visibility in Slack does not authorize unattended vendor/owner messaging. Missing contact information blocks sending until corrected. Map Penny and Craig to their active Slack identities and verify scoped chase-review permission; do not promote either account to a broader role merely to expose this action.

Example only (fictional):

> WO 1234 · Example property, Unit B — kitchen faucet repair
> Vendor estimate outstanding · 6 business days in this step
> HDPM owner: Cheryl · Vendor: Example Plumbing
> Last confirmed contact: Friday by email · No reply recorded
> Next action: request an ETA for the bid
> [Review & send] [Snooze] [Open work order]

## Shared state and reliability

- Store review state once; both surfaces use the same action API, permissions and versions.
- Keep delivery state separate from follow-up state. Unknown delivery requires manual checking, not automatic resend.
- Preserve durable send claims and prevent duplicate actions from stale Slack cards or concurrent reviewers.
- Recheck source eligibility, contact, latest message version and authorization immediately before sending.
- Use one cooldown across old and new chaser paths. The existing follow-up draft uses three calendar days, while the older chase policy uses business days: settle on three business days for routine outbound repeats unless a staff member explicitly records a different next action.
- Reconcile recorded work-order progress so obsolete reminders stop; stale source data must not silently become a resolved item.
- Link escalations into existing EOS issues with a stable source reference. Update the linked issue instead of filing duplicates. Preserve human ownership of EOS resolution.
- Slack retries and message updates must be idempotent. Make sync failure, missing permissions and disabled sending visible.

## What exists and what must change

Repository inspection found:

- Existing estimate chaser: candidate classification, cooldowns, Slack SMS-review cards, Outlook draft delivery and escalations. Running configuration and delivery success were not verified in this planning pass.
- Existing Company Issues: aged/recurring work-order exceptions and agent escalations, source links, priority, discussion/parking and human resolution. Current work-order evidence is limited to identity, stage, vendor and source links.
- Uncommitted estimate-followup implementation: editable email/SMS review, snooze/dismiss, history, optimistic versions and durable delivery claims. Its production availability and database migration state are unverified.
- Shared dashboard thresholds already exist and should govern new follow-up detection.

Implementation order:

1. Resolve Penny and Craig to active staff/Slack identities; confirm cadence and outbound sender identity. Verify live agent settings, migrations, source freshness, review permissions and delivery setup read-only.
2. Unify candidate data and action history. Add work-order scheduling candidates, responsible staff, next action, source timestamps and linked-estimate information. Reconcile legacy chase activity without treating prepared drafts as confirmed sends.
3. Put the operational queue and detail on Company Issues; link Work & Billing to it. Preserve the existing EOS queue and dedupe escalations.
4. Add the Slack summary and shared deep links, then the agreed Slack actions. Coordinate cutover with existing chase delivery so only one path operates on an item.
5. Test with actual selected items in preview. Pilot a small reviewed set before enabling routine notifications or outbound sends.

Acceptance examples: an unscheduled WO and a vendor estimate appear in both surfaces; the detail supplies enough context to act; action in either surface is reflected on refresh in the other; simultaneous sends produce one attempt; snoozed/resolved work stops nudging; failed/unknown delivery is visible; the same escalation does not become two EOS issues; an unknown amount/contact is never invented.

## Trial defaults and production checks

- Penny and Craig are the confirmed initial reviewers; separate Slack DMs are the working delivery assumption. Work-order owners retain responsibility for completing work.
- Weekday summaries default to 8 AM Pacific. Verify the configured email/Zoom identity in production before activation.
- All routine follow-ups appear on Company Issues, with Request help linking to an EOS issue. Completion/billing chases remain a later extension.
