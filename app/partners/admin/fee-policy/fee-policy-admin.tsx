'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PARTNER_TYPES, FEE_KINDS, type FeePolicyRow, type PartnerType, type FeeKind } from '@/lib/referrals/types';

const TYPE_LABEL: Record<PartnerType, string> = {
  owner: 'Owner',
  agent: 'Agent (licensed)',
  builder: 'Builder / Developer',
  vendor: 'Vendor',
  other: 'Other',
};
const KIND_LABEL: Record<FeeKind, string> = {
  one_time_bounty: 'One-time bounty',
  trailing: 'Trailing fee',
};

export default function FeePolicyAdmin({ initialPolicies }: { initialPolicies: FeePolicyRow[] }) {
  const [policies, setPolicies] = useState(initialPolicies);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cell = (type: PartnerType, kind: FeeKind) =>
    policies.find((p) => p.partner_type === type && p.fee_kind === kind);

  async function toggle(type: PartnerType, kind: FeeKind, next: boolean) {
    const key = `${type}:${kind}`;
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch('/api/partners/admin/fee-policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_type: type, fee_kind: kind, allowed: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Update failed');
      setPolicies((ps) =>
        ps.map((p) => (p.partner_type === type && p.fee_kind === kind ? { ...p, allowed: next } : p))
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
              <th className="px-4 py-3 font-medium">Referrer type</th>
              {FEE_KINDS.map((k) => (
                <th key={k} className="px-4 py-3 font-medium">
                  {KIND_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PARTNER_TYPES.map((type) => (
              <tr key={type} className="border-b border-sand-100 last:border-0">
                <td className="px-4 py-3 font-medium text-charcoal-800">{TYPE_LABEL[type]}</td>
                {FEE_KINDS.map((kind) => {
                  const c = cell(type, kind);
                  const allowed = c?.allowed ?? false;
                  const key = `${type}:${kind}`;
                  return (
                    <td key={kind} className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Badge tone={allowed ? 'success' : 'neutral'}>{allowed ? 'Enabled' : 'Disabled'}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === key}
                          onClick={() => toggle(type, kind, !allowed)}
                        >
                          {busy === key ? '…' : allowed ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-charcoal-400">
        Note: <code>first_rent</code> bounty trigger and trailing fees still depend on downstream data
        (Batch 6a AppFolio fee-income spike). Enabling a cell here only permits setting terms — it does not
        make an unbuilt computation run.
      </p>
    </div>
  );
}
