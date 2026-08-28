/**
 * Referral notification templates (Batch 4) — pure, testable. Content only; the
 * send + log wrapper is lib/referrals/notify.ts.
 */

import type { LeadStage } from './types';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const wrap = (title: string, body: string): string =>
  `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#2d2a33">
  <h2 style="font-size:18px;margin:0 0 12px">${title}</h2>
  ${body}
  <hr style="border:none;border-top:1px solid #e8e8ed;margin:20px 0" />
  <p style="font-size:12px;color:#9a9aa5">High Desert Property Management — Referral Partner Program</p>
</div>`;

/** Human-friendly stage label for referrer-facing copy. */
export function stageLabel(stage: LeadStage): string {
  const map: Record<LeadStage, string> = {
    submitted: 'Submitted',
    contacted: 'Contacted',
    qualified: 'Qualified',
    agreement_signed: 'Agreement signed',
    onboarding: 'Onboarding',
    active: 'Active (under management)',
    closed: 'Closed',
    lost: 'Not moving forward',
  };
  return map[stage] ?? stage;
}

/** Notify the referrer only on a real transition (skip no-ops). */
export function shouldNotifyStatusChange(from: LeadStage | null, to: LeadStage): boolean {
  return from !== to;
}

export function buildLeadSubmittedEmail(input: {
  prospect_name: string;
  source: string;
  partner_name?: string | null;
}): EmailContent {
  const who = input.partner_name ? `${input.partner_name} (${input.source})` : input.source;
  return {
    subject: `New referral lead: ${input.prospect_name}`,
    html: wrap(
      'New referral lead',
      `<p><strong>${input.prospect_name}</strong> was just submitted via <strong>${who}</strong>.</p>
       <p>Open the pipeline to review and work it.</p>`
    ),
    text: `New referral lead: ${input.prospect_name} (via ${who}). Open the pipeline to review.`,
  };
}

export function buildStatusChangeEmail(input: {
  prospect_name: string;
  to: LeadStage;
}): EmailContent {
  const label = stageLabel(input.to);
  return {
    subject: `Your referral ${input.prospect_name} is now: ${label}`,
    html: wrap(
      'Referral status update',
      `<p>Your referral <strong>${input.prospect_name}</strong> has moved to:</p>
       <p style="font-size:16px"><strong>${label}</strong></p>
       <p>Sign in to your partner dashboard to see details.</p>`
    ),
    text: `Your referral ${input.prospect_name} is now: ${label}. Sign in to your partner dashboard for details.`,
  };
}

export function buildW9MissingEmail(input: { partner_name: string }): EmailContent {
  return {
    subject: 'Action needed: W-9 on file',
    html: wrap(
      'We need your W-9',
      `<p>Hi ${input.partner_name}, we don't have a completed W-9 on file for your referral
       partner account. We need it before any referral fee can be paid.</p>
       <p>Sign in to your partner dashboard to upload it.</p>`
    ),
    text: `Hi ${input.partner_name}, we need a completed W-9 on file before any referral fee can be paid. Sign in to upload it.`,
  };
}
