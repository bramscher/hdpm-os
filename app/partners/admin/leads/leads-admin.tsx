'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { LEAD_STAGES, type LeadStage, type ReferralLead } from '@/lib/referrals/types';

const STAGE_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  submitted: 'info',
  contacted: 'info',
  qualified: 'info',
  agreement_signed: 'success',
  onboarding: 'success',
  active: 'success',
  closed: 'neutral',
  lost: 'danger',
};

export default function LeadsAdmin({ initialLeads }: { initialLeads: ReferralLead[] }) {
  const [leads] = useState(initialLeads);
  const [stage, setStage] = useState<LeadStage | 'all'>('all');
  const [source, setSource] = useState<'all' | 'referral' | 'organic'>('all');

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) => (stage === 'all' || l.stage === stage) && (source === 'all' || l.source === source)
      ),
    [leads, stage, source]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={stage}
          onChange={(e) => setStage(e.target.value as LeadStage | 'all')}
        >
          <option value="all">All stages</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={source}
          onChange={(e) => setSource(e.target.value as 'all' | 'referral' | 'organic')}
        >
          <option value="all">All sources</option>
          <option value="referral">Referral</option>
          <option value="organic">Organic</option>
        </select>
        <span className="text-xs text-charcoal-400">{filtered.length} of {leads.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
              <th className="px-4 py-3 font-medium">Prospect</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Flags</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-charcoal-400">
                  No leads match.
                </td>
              </tr>
            )}
            {filtered.map((l) => (
              <tr key={l.id} className="border-b border-sand-100 last:border-0 hover:bg-sand-50">
                <td className="px-4 py-3">
                  <Link href={`/partners/admin/leads/${l.id}`} className="font-medium text-charcoal-800 hover:underline">
                    {l.prospect_name}
                  </Link>
                  {l.prospect_email && <div className="text-xs text-charcoal-400">{l.prospect_email}</div>}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={l.source === 'referral' ? 'terra' : 'neutral'}>{l.source}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={STAGE_TONE[l.stage] ?? 'neutral'}>{l.stage}</Badge>
                </td>
                <td className="px-4 py-3">
                  {l.dup_status === 'suspected' && <Badge tone="warning">dup?</Badge>}
                  {l.dup_status === 'confirmed' && <Badge tone="danger">duplicate</Badge>}
                </td>
                <td className="px-4 py-3 text-charcoal-500">{new Date(l.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
