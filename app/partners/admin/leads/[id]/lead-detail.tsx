'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BACKFILL_STAGES, LEAD_STAGES, type FeeAgreementRow, type LedgerEntry, type LeadEvent, type LeadStage, type ReferralLead } from '@/lib/referrals/types';
import type { BountyDecision } from '@/lib/referrals/bounty';
import BountyCard from './bounty-card';

export default function LeadDetail({
  lead,
  events,
  ledger,
  agreement,
  preview,
}: {
  lead: ReferralLead;
  events: LeadEvent[];
  ledger: LedgerEntry[];
  agreement: FeeAgreementRow | null;
  preview: BountyDecision | null;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<LeadStage>(lead.stage);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [af, setAf] = useState({
    owner: lead.appfolio_owner_id ?? '',
    props: (lead.appfolio_property_ids ?? []).join(', '),
    doors: lead.doors_under_mgmt?.toString() ?? '',
  });
  const [email, setEmail] = useState('');

  async function patch(action: string, extra: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setErr(null);
    try {
      const res = await fetch(`/api/partners/admin/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/partners/admin/leads" className="text-sm text-charcoal-500 hover:underline">
          ← Pipeline
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-charcoal-900">{lead.prospect_name}</h1>
          <Badge tone={lead.source === 'referral' ? 'terra' : 'neutral'}>{lead.source}</Badge>
          {lead.dup_status === 'suspected' && <Badge tone="warning">suspected duplicate</Badge>}
          {lead.dup_status === 'confirmed' && <Badge tone="danger">duplicate</Badge>}
        </div>
        <div className="mt-1 text-sm text-charcoal-500">
          {lead.prospect_email} {lead.prospect_phone && `· ${lead.prospect_phone}`}
          {lead.ref_code && ` · ref ${lead.ref_code}`}
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* One pipeline: is this referral on the website's owner pipeline board? */}
      {lead.hdpm_web_lead_id ? (
        <p className="text-sm text-charcoal-600">On the owner pipeline board (website lead #{lead.hdpm_web_lead_id}).</p>
      ) : !(BACKFILL_STAGES as readonly string[]).includes(lead.stage) ? null : !lead.prospect_email ? (
        <form
          className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
          onSubmit={(e) => {
            e.preventDefault();
            patch('set_email', { email }, 'email');
          }}
        >
          <span className="font-medium">Not on the board: needs email.</span>
          <span>The website needs an email to add this owner to the pipeline.</span>
          <input
            type="email"
            required
            placeholder="owner@example.com"
            className="h-8 rounded-md border border-amber-300 bg-white px-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy === 'email'} className="rounded-md bg-amber-700 px-3 py-1 font-medium text-white disabled:opacity-60">
            {busy === 'email' ? 'Saving…' : 'Save and add to board'}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">Not on the board yet.</span>
          <span>The push to the website didn&apos;t go through.</span>
          <button onClick={() => patch('push_to_website', {}, 'push')} disabled={busy === 'push'} className="rounded-md bg-amber-700 px-3 py-1 font-medium text-white disabled:opacity-60">
            {busy === 'push' ? 'Sending…' : 'Retry'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Stage */}
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-charcoal-800">Stage</h2>
          <div className="flex gap-2">
            <select
              className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              value={stage}
              onChange={(e) => setStage(e.target.value as LeadStage)}
            >
              {LEAD_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button disabled={busy === 'stage' || stage === lead.stage} onClick={() => patch('stage', { stage }, 'stage')}>
              {busy === 'stage' ? '…' : 'Update'}
            </Button>
          </div>
        </div>

        {/* Dedupe */}
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-charcoal-800">Duplicate resolution</h2>
          {lead.dup_status === 'suspected' ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy === 'dedupe'} onClick={() => patch('dedupe', { decision: 'cleared' }, 'dedupe')}>
                Not a duplicate
              </Button>
              <Button variant="destructive" size="sm" disabled={busy === 'dedupe'} onClick={() => patch('dedupe', { decision: 'confirmed' }, 'dedupe')}>
                Confirm duplicate
              </Button>
            </div>
          ) : (
            <p className="text-sm text-charcoal-400">
              {lead.dup_status ? `Resolved: ${lead.dup_status}` : 'No duplicate flagged.'}
            </p>
          )}
        </div>

        {/* AppFolio link (at signing) */}
        <div className="rounded-xl border border-sand-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-charcoal-800">AppFolio link</h2>
          <p className="mb-3 text-xs text-charcoal-400">
            Set at signing — links this lead to the owner + properties. Doors under management drives fees.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-charcoal-500">
              Owner ID
              <Input className="mt-1" value={af.owner} onChange={(e) => setAf({ ...af, owner: e.target.value })} />
            </label>
            <label className="text-xs text-charcoal-500">
              Property IDs (comma-sep)
              <Input className="mt-1" value={af.props} onChange={(e) => setAf({ ...af, props: e.target.value })} />
            </label>
            <label className="text-xs text-charcoal-500">
              Doors
              <Input className="mt-1" type="number" value={af.doors} onChange={(e) => setAf({ ...af, doors: e.target.value })} />
            </label>
          </div>
          <div className="mt-3">
            <Button
              size="sm"
              disabled={busy === 'link'}
              onClick={() =>
                patch(
                  'link_appfolio',
                  {
                    appfolio_owner_id: af.owner || null,
                    appfolio_property_ids: af.props ? af.props.split(',').map((s) => s.trim()).filter(Boolean) : null,
                    doors_under_mgmt: af.doors ? Number(af.doors) : null,
                  },
                  'link'
                )
              }
            >
              {busy === 'link' ? 'Saving…' : 'Save link'}
            </Button>
          </div>
        </div>

        <BountyCard lead={lead} ledger={ledger} agreement={agreement} preview={preview} busy={busy} patch={patch} />
      </div>

      {/* History */}
      <div className="rounded-xl border border-sand-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-charcoal-800">History</h2>
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0 text-xs text-charcoal-400">
                {new Date(e.created_at).toLocaleString()}
              </span>
              <span>
                <Badge tone="neutral">{e.event_type}</Badge>{' '}
                <span className="text-charcoal-600">
                  {Object.keys(e.payload || {}).length > 0 && JSON.stringify(e.payload)}
                </span>
                <span className="ml-1 text-xs text-charcoal-400">— {e.actor}</span>
              </span>
            </li>
          ))}
          {events.length === 0 && <li className="text-sm text-charcoal-400">No events.</li>}
        </ul>
      </div>
    </div>
  );
}
