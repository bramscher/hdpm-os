'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/dialog';
import {
  PARTNER_TYPES,
  FEE_KINDS,
  type FeePolicyRow,
  type PartnerType,
  type FeeKind,
  type ReferralPartner,
} from '@/lib/referrals/types';

const TYPE_LABEL: Record<PartnerType, string> = {
  owner: 'Owner',
  agent: 'Agent',
  builder: 'Builder',
  vendor: 'Vendor',
  other: 'Other',
};

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' ? 'success' : status === 'pending' ? 'info' : status === 'paused' ? 'warning' : 'danger';
  return <Badge tone={tone as 'success' | 'info' | 'warning' | 'danger'}>{status}</Badge>;
}

export default function ReferrersAdmin({
  initialReferrers,
  policies,
}: {
  initialReferrers: ReferralPartner[];
  policies: FeePolicyRow[];
}) {
  const router = useRouter();
  const [referrers, setReferrers] = useState(initialReferrers);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [form, setForm] = useState({ type: 'owner' as PartnerType, display_name: '', company: '', email: '', phone: '', license_number: '' });

  // terms modal
  const [termsFor, setTermsFor] = useState<ReferralPartner | null>(null);

  // invite link modal
  const [inviteLink, setInviteLink] = useState<{ name: string; url: string } | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const [w9SendingId, setW9SendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function sendW9Reminder(r: ReferralPartner) {
    setW9SendingId(r.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/partners/admin/referrers/${r.id}/w9-reminder`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed');
      setNotice(`W-9 reminder sent to ${r.display_name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setW9SendingId(null);
    }
  }

  async function invite(r: ReferralPartner, deliver: 'email' | 'link' = 'link') {
    setInvitingId(r.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/partners/admin/referrers/${r.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliver }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Invite failed');
      if (deliver === 'email') {
        if (body.sent) {
          setNotice(`Invite emailed to ${body.email}.`);
        } else {
          // Email didn't deliver (e.g. DKIM/SPF not set) — fall back to the link.
          setInviteLink({ name: r.display_name, url: body.url });
          setError(`Couldn't email the invite (${body.detail || body.status}). Copy the link below instead.`);
        }
      } else {
        setInviteLink({ name: r.display_name, url: body.url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInvitingId(null);
    }
  }

  const allowedKinds = (type: PartnerType): FeeKind[] =>
    FEE_KINDS.filter((k) => policies.some((p) => p.partner_type === type && p.fee_kind === k && p.allowed));

  async function refresh() {
    const res = await fetch('/api/partners/admin/referrers');
    if (res.ok) setReferrers((await res.json()).referrers);
  }

  async function doCreate(alsoEmailInvite: boolean) {
    setError(null);
    setNotice(null);
    setCreating(true);
    try {
      const res = await fetch('/api/partners/admin/referrers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Create failed');
      setReferrers((r) => [body.referrer, ...r]);
      setForm({ type: 'owner', display_name: '', company: '', email: '', phone: '', license_number: '' });
      if (alsoEmailInvite) await invite(body.referrer, 'email');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function createReferrer(e: React.FormEvent) {
    e.preventDefault();
    void doCreate(false);
  }

  async function setStatus(id: string, status: 'active' | 'paused' | 'terminated') {
    const res = await fetch(`/api/partners/admin/referrers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const { referrer } = await res.json();
      setReferrers((rs) => rs.map((r) => (r.id === id ? referrer : r)));
    }
  }

  return (
    <div className="space-y-8">
      {notice && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {notice}
        </div>
      )}

      {/* Create form */}
      <form onSubmit={createReferrer} className="rounded-xl border border-sand-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-charcoal-800">New referrer</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-charcoal-500">
            Type
            <select
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as PartnerType })}
            >
              {PARTNER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-charcoal-500">
            Name *
            <Input className="mt-1" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Jane Smith" />
          </label>
          <label className="text-xs text-charcoal-500">
            Company
            <Input className="mt-1" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </label>
          <label className="text-xs text-charcoal-500">
            Email
            <Input className="mt-1" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="text-xs text-charcoal-500">
            Phone
            <Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="text-xs text-charcoal-500">
            License # {form.type === 'agent' && <span className="text-terra-600">(agents)</span>}
            <Input className="mt-1" value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={creating || !form.display_name.trim()}>
            {creating ? 'Creating…' : 'Create referrer'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={creating || !form.display_name.trim() || !form.email.trim()}
            title={!form.email.trim() ? 'Add an email to send the invite' : undefined}
            onClick={() => doCreate(true)}
          >
            Create &amp; email invite
          </Button>
        </div>
      </form>

      {/* List */}
      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
              <th className="px-4 py-3 font-medium">Referrer</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Terms</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {referrers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-charcoal-400">
                  No referrers yet — create the first one above.
                </td>
              </tr>
            )}
            {referrers.map((r) => (
              <tr key={r.id} className="border-b border-sand-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-charcoal-800">{r.display_name}</div>
                  {r.company && <div className="text-xs text-charcoal-400">{r.company}</div>}
                  {r.email && <div className="text-xs text-charcoal-400">{r.email}</div>}
                </td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">{TYPE_LABEL[r.type]}</Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-charcoal-600">{r.referral_code}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  {allowedKinds(r.type).length === 0 ? (
                    <span className="text-xs text-charcoal-400">no fee type enabled</span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setTermsFor(r)}>
                      Set terms
                    </Button>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-2">
                    {r.email && (
                      <Button variant="outline" size="sm" disabled={invitingId === r.id} onClick={() => invite(r, 'email')}>
                        {invitingId === r.id ? '…' : r.auth_user_id ? 'Re-email invite' : 'Email invite'}
                      </Button>
                    )}
                    {r.email && (
                      <Button variant="ghost" size="sm" disabled={invitingId === r.id} onClick={() => invite(r, 'link')}>
                        Copy link
                      </Button>
                    )}
                    {r.status !== 'active' && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(r.id, 'active')}>
                        Activate
                      </Button>
                    )}
                    {r.status !== 'paused' && r.status !== 'terminated' && (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(r.id, 'paused')}>
                        Pause
                      </Button>
                    )}
                    {r.w9_status === 'missing' && r.email && (
                      <Button variant="ghost" size="sm" disabled={w9SendingId === r.id} onClick={() => sendW9Reminder(r)}>
                        {w9SendingId === r.id ? '…' : 'W-9 reminder'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-charcoal-400">
        Fee terms are gated by the compensation-eligibility policy (Oregon). If a type shows “no fee type
        enabled”, turn it on in{' '}
        <a href="/partners/admin/fee-policy" className="underline">
          Fee policy
        </a>{' '}
        after legal sign-off.
      </p>

      {inviteLink && (
        <Modal
          title={`Invite link — ${inviteLink.name}`}
          onClose={() => setInviteLink(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setInviteLink(null)}>
                Close
              </Button>
              <Button onClick={() => navigator.clipboard?.writeText(inviteLink.url)}>Copy link</Button>
            </>
          }
        >
          <p className="text-sm text-charcoal-600">
            Send this one-time link to the referrer. It expires in 14 days and can only be used once.
          </p>
          <div className="mt-3 break-all rounded-md border border-sand-200 bg-sand-50 p-3 font-mono text-xs text-charcoal-700">
            {inviteLink.url}
          </div>
        </Modal>
      )}

      {termsFor && (
        <TermsModal
          referrer={termsFor}
          allowedKinds={allowedKinds(termsFor.type)}
          onClose={() => setTermsFor(null)}
          onSaved={() => {
            setTermsFor(null);
            refresh();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function TermsModal({
  referrer,
  allowedKinds,
  onClose,
  onSaved,
}: {
  referrer: ReferralPartner;
  allowedKinds: FeeKind[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [feeKind, setFeeKind] = useState<FeeKind>(allowedKinds[0]);
  const [bountyMode, setBountyMode] = useState<'fixed' | 'per_door'>('fixed');
  const [bountyAmount, setBountyAmount] = useState('');
  const [trailingPct, setTrailingPct] = useState('');
  const [trailingMonths, setTrailingMonths] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = { fee_kind: feeKind };
      if (feeKind === 'one_time_bounty') {
        payload.bounty_mode = bountyMode;
        payload.bounty_amount = Number(bountyAmount) || 0;
        payload.bounty_trigger = 'agreement_signed';
      } else {
        payload.trailing_pct = Number(trailingPct) || 0;
        payload.trailing_months = Number(trailingMonths) || 0;
      }
      const res = await fetch(`/api/partners/admin/referrers/${referrer.id}/terms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Default fee terms — ${referrer.display_name}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save terms'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-xs text-charcoal-500">
          Fee kind
          <select
            className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={feeKind}
            onChange={(e) => setFeeKind(e.target.value as FeeKind)}
          >
            {allowedKinds.map((k) => (
              <option key={k} value={k}>
                {k === 'one_time_bounty' ? 'One-time bounty' : 'Trailing fee'}
              </option>
            ))}
          </select>
        </label>

        {feeKind === 'one_time_bounty' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-charcoal-500">
              Mode
              <select
                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={bountyMode}
                onChange={(e) => setBountyMode(e.target.value as 'fixed' | 'per_door')}
              >
                <option value="fixed">Fixed amount</option>
                <option value="per_door">Per door</option>
              </select>
            </label>
            <label className="text-xs text-charcoal-500">
              Amount ($)
              <Input className="mt-1" type="number" value={bountyAmount} onChange={(e) => setBountyAmount(e.target.value)} />
            </label>
            <p className="col-span-2 text-xs text-charcoal-400">Trigger: on agreement signed (first-rent trigger deferred — no AppFolio source yet).</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-charcoal-500">
              % of mgmt fee
              <Input className="mt-1" type="number" value={trailingPct} onChange={(e) => setTrailingPct(e.target.value)} />
            </label>
            <label className="text-xs text-charcoal-500">
              Months
              <Input className="mt-1" type="number" value={trailingMonths} onChange={(e) => setTrailingMonths(e.target.value)} />
            </label>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}
