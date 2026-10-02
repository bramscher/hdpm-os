'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BOUNTY_STATUS_LABEL, bountyStatus, nextActions, summarizeLedger, type BountyDecision } from '@/lib/referrals/bounty';
import type { FeeAgreementRow, LedgerEntry, ReferralLead } from '@/lib/referrals/types';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const SIGNED_OR_LATER = new Set(['agreement_signed', 'onboarding', 'active', 'closed']);

const TONE = { none: 'neutral', pending_approval: 'warning', approved: 'terra', paid: 'success', voided: 'danger' } as const;

/** Batch 5: the lead's one-time bounty — frozen terms, ledger rows, and the next valid action. */
export default function BountyCard({
  lead,
  ledger,
  agreement,
  preview,
  busy,
  patch,
}: {
  lead: ReferralLead;
  ledger: LedgerEntry[];
  agreement: FeeAgreementRow | null;
  preview: BountyDecision | null;
  busy: string | null;
  patch: (action: string, extra: Record<string, unknown>, tag: string) => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const status = bountyStatus(ledger);
  const actions = nextActions(ledger);
  const totals = summarizeLedger(ledger);
  const signed = SIGNED_OR_LATER.has(lead.stage);

  if (!lead.partner_id) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-5 lg:col-span-2">
        <h2 className="text-sm font-semibold text-charcoal-800">Bounty</h2>
        <p className="mt-1 text-sm text-charcoal-500">Organic lead: no referrer, so no bounty.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sand-200 bg-white p-5 lg:col-span-2">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-charcoal-800">Bounty</h2>
        <Badge tone={TONE[status]}>{BOUNTY_STATUS_LABEL[status]}</Badge>
        {status !== 'none' && <span className="text-sm font-semibold text-charcoal-900">{usd(totals.earned)}</span>}
      </div>
      <p className="mb-3 text-xs text-charcoal-400">
        Earned automatically when the lead first moves to agreement signed, if the referrer has bounty terms and the fee policy allows
        their type. Approve, then mark paid. Every step is a permanent ledger entry.
      </p>

      {agreement && (
        <p className="mb-3 text-sm text-charcoal-600">
          Terms frozen at signing:{' '}
          <strong>
            {agreement.bounty_mode === 'per_door' ? `${usd(Number(agreement.bounty_amount))} per door` : usd(Number(agreement.bounty_amount))}
          </strong>{' '}
          on {new Date(agreement.signed_at).toLocaleDateString()}
        </p>
      )}

      {status === 'none' && (
        <div className="rounded-lg bg-sand-50 p-3 text-sm text-charcoal-600">
          {!signed ? (
            <>Not earned yet. {preview?.earn ? `Signing will earn ${usd(preview.amount)}.` : preview ? `If signed now: ${preview.reason}` : ''}</>
          ) : preview?.earn ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>Ready to earn {usd(preview.amount)}.</span>
              <Button size="sm" disabled={busy === 'earn'} onClick={() => patch('earn_bounty', {}, 'earn')}>
                {busy === 'earn' ? 'Earning…' : `Earn ${usd(preview.amount)} bounty`}
              </Button>
            </div>
          ) : (
            <>Not earned: {preview?.reason ?? 'unknown'}</>
          )}
        </div>
      )}

      {ledger.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y divide-sand-100">
            {ledger.map((e) => (
              <tr key={e.id}>
                <td className="py-1.5 pr-3 text-xs text-charcoal-400">{new Date(e.created_at).toLocaleDateString()}</td>
                <td className="py-1.5 pr-3 font-medium capitalize">{e.entry_type}</td>
                <td className="py-1.5 pr-3 tabular-nums">{usd(Number(e.amount))}</td>
                <td className="py-1.5 pr-3 text-charcoal-500">
                  {e.reason}
                  {e.qbo_reference && ` · ref ${e.qbo_reference}`}
                </td>
                <td className="py-1.5 text-xs text-charcoal-400">{e.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(actions.approve || actions.markPaid || actions.void) && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-sand-100 pt-4">
          {actions.approve && (
            <Button size="sm" disabled={!!busy} onClick={() => patch('approve_bounty', {}, 'approve')}>
              {busy === 'approve' ? 'Approving…' : `Approve ${usd(totals.pendingApproval)}`}
            </Button>
          )}
          {actions.markPaid && (
            <div className="flex items-end gap-2">
              <label className="text-xs text-charcoal-500">
                Payment reference
                <Input className="mt-1 w-48" placeholder="Check # / QBO ref" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
              <Button size="sm" disabled={!!busy || !reference.trim()} onClick={() => patch('mark_paid', { reference }, 'paid')}>
                {busy === 'paid' ? 'Saving…' : `Mark ${usd(totals.approvedUnpaid)} paid`}
              </Button>
            </div>
          )}
          {actions.void && (
            <div className="ml-auto flex items-end gap-2">
              <label className="text-xs text-charcoal-500">
                Void reason
                <Input className="mt-1 w-56" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
              </label>
              <Button size="sm" variant="outline" disabled={!!busy || !voidReason.trim()} onClick={() => patch('void_bounty', { reason: voidReason }, 'void')}>
                {busy === 'void' ? 'Voiding…' : 'Void'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
