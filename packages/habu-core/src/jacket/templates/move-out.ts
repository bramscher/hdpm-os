/**
 * HDPM Move-Out jacket template — the first real Phase-B template (execution-plan
 * step B.1). A digital replica of the physical yellow "Vacancy Tracking" jacket
 * (form rev 11/2025), authored from the paper original + the 30-Day-Notice SOP +
 * spec Appendix A.1.
 *
 * Color = process identity (A.0): move-out is always YELLOW; the "needs you" dot
 * is the separate derived `attention` signal.
 *
 * Structure = FIVE PARALLEL TRACKS (App A.1), not one linear list — different
 * seats work them at once, gated by events rather than by each other:
 *   TENANT      → move_out       (notice intake, confirmation, inspection)
 *   OWNER       → pm             (owner decisions; re-list prep)
 *   ADVERTISING → listing        (re-list the unit)
 *   VACANCY     → move_out       (key return)
 *   CLOSE OUT   → finance_closer (final accounting, escalates to Penny)
 *
 * Steps carry a `seat_role` string (not a seat id) — role→seat resolves via
 * `seat.roles[]` at instantiation, so renaming a seat never rewires the template.
 * The roles used here (move_out, pm, listing, finance_closer) all exist on the
 * HDPM roster seats (supabase/seeds/habu_hdpm_roster.sql).
 *
 * OWNER-SELLING BRANCH: the paper jacket crosses out the OWNER + ADVERTISING
 * (re-list) sections when the owner is selling. Digitally that's a runtime
 * skip — the coordinator/agent marks those steps `skipped` (audit-preserved),
 * the equivalent of the diagonal cross-out. No branch logic lives in the
 * template (the engine has none yet); this is deliberate — see the plan's flags.
 *
 * v1 is tap-driven. Verify-by-read (`requires: 'external_event'` + a real
 * `external_match`) is deferred until the persistence layer (PR-A8) and confirmed
 * AppFolio webhooks land — encoding fake events now would be dishonest. Only the
 * `created` due-anchor is wired today, so the early TENANT steps use `created+Nbd`
 * and the event-gated later tracks carry no due rule.
 */
import type { JacketTemplate } from '../types';

export const MOVE_OUT_TEMPLATE: JacketTemplate = {
  id: 'hdpm-move-out',
  org_id: 'hdpm',
  key: 'move-out',
  title: 'Move-out',
  color: 'yellow',
  active: true,
  steps: [
    // ── TENANT (front-desk intake; opens at notice) ──────────────────────
    { label: 'Save move-out date in AppFolio', track: 'TENANT', seat_role: 'move_out', due_rule: 'created+1bd' },
    { label: 'Confirm forwarding address (else calendar follow-up)', track: 'TENANT', seat_role: 'move_out', due_rule: 'created+3bd' },
    { label: 'Send move-out confirmation to tenant', track: 'TENANT', seat_role: 'move_out' },
    { label: 'Enter prorated rent', track: 'TENANT', seat_role: 'move_out' },
    { label: 'Calendar move-out inspection (day after keys due)', track: 'TENANT', seat_role: 'move_out' },
    { label: 'Check for scheduled property inspection', track: 'TENANT', seat_role: 'move_out' },
    { label: 'Submit to Property Manager', track: 'TENANT', seat_role: 'move_out' },

    // ── OWNER (human PM decisions; skipped when owner is selling) ─────────
    { label: 'Notify owner of move-out', track: 'OWNER', seat_role: 'pm' },
    { label: 'Owner termination fee (if applicable)', track: 'OWNER', seat_role: 'pm' },
    { label: 'Set rent amount for new listing', track: 'OWNER', seat_role: 'pm' },
    { label: 'Confirm W/D, utilities, landscaping, pets, lease term', track: 'OWNER', seat_role: 'pm' },
    { label: 'Set availability date', track: 'OWNER', seat_role: 'pm' },

    // ── ADVERTISING (re-list; skipped when owner is selling) ─────────────
    { label: 'Check utility / appliance info', track: 'ADVERTISING', seat_role: 'listing' },
    { label: 'Update AppFolio / website', track: 'ADVERTISING', seat_role: 'listing' },
    { label: 'Update Craigslist', track: 'ADVERTISING', seat_role: 'listing' },
    { label: 'Attach posting to property page', track: 'ADVERTISING', seat_role: 'listing' },
    { label: 'Charge ad fee', track: 'ADVERTISING', seat_role: 'listing' },

    // ── VACANCY (key return) ─────────────────────────────────────────────
    { label: 'Email key reminder + forwarding address', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Record keys returned (date / by / via)', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Enter actual move-out date in AppFolio', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Record key counts (house / mail / garage / pool)', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Holdover rent? — if yes, email finance to charge', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Receipt keys in / pull all keys to PM inspection box', track: 'VACANCY', seat_role: 'move_out' },
    { label: 'Set new-tenant move-in date', track: 'VACANCY', seat_role: 'move_out' },

    // ── CLOSE OUT (final accounting; escalates to Penny) ─────────────────
    { label: 'Early termination fee — email finance to charge', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Enter forwarding address in AppFolio', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Check outstanding balances', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Create final accounting', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Enter vendor invoices', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Transfer funds / post management fees', track: 'CLOSE OUT', seat_role: 'finance_closer' },
    { label: 'Mail check & info to tenant', track: 'CLOSE OUT', seat_role: 'finance_closer' }, // the jacket's "done"
  ],
};
