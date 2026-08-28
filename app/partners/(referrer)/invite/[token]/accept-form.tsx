'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Accept form (Batch 2). Posts multipart to /api/partners/invite/accept. The
 * TIN is sent once over HTTPS and encrypted server-side (never stored cleartext,
 * never logged). On success the referrer is directed to magic-link login.
 */
export default function AcceptForm({
  token,
  email,
  agreementText,
  agreementVersion,
}: {
  token: string;
  email: string;
  agreementText: string;
  agreementVersion: string;
}) {
  const [legalName, setLegalName] = useState('');
  const [tin, setTin] = useState('');
  const [addr, setAddr] = useState({ line1: '', city: '', state: '', zip: '' });
  const [w9, setW9] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!accepted) {
      setErr('Please accept the referral agreement to continue.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('token', token);
      fd.set('email', email);
      fd.set('agreementAccepted', 'true');
      fd.set('legalName', legalName);
      fd.set('taxId', tin);
      fd.set('taxAddress', JSON.stringify(addr));
      if (w9) fd.set('w9', w9);
      const res = await fetch('/api/partners/invite/accept', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not complete setup');
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6">
        <h2 className="text-lg font-semibold text-green-900">You&apos;re all set</h2>
        <p className="mt-2 text-sm text-green-800">
          Your referral partner account is active. Sign in any time with a secure email link.
        </p>
        <a href="/partners/login" className="mt-4 inline-block">
          <Button>Go to sign in</Button>
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Email (confirm) */}
      <div className="rounded-xl border border-sand-200 bg-white p-5">
        <label className="block text-xs text-charcoal-500">
          Your email (used to sign in)
          <Input className="mt-1" value={email} readOnly />
        </label>
      </div>

      {/* Agreement */}
      <div className="rounded-xl border border-sand-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-charcoal-800">Referral agreement</h2>
        <p className="mb-2 text-xs text-charcoal-400">Version {agreementVersion}</p>
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-sand-200 bg-sand-50 p-3 text-xs text-charcoal-700">
          {agreementText}
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-charcoal-700">
          <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I have read and agree to the referral partner agreement.
        </label>
      </div>

      {/* Tax info */}
      <div className="rounded-xl border border-sand-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-charcoal-800">Tax information (for 1099-NEC)</h2>
        <p className="mb-3 text-xs text-charcoal-400">
          Your tax ID is encrypted and never shown again — we keep only the last 4 digits for reference.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-charcoal-500">
            Legal name
            <Input className="mt-1" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </label>
          <label className="text-xs text-charcoal-500">
            Tax ID (SSN or EIN)
            <Input className="mt-1" value={tin} onChange={(e) => setTin(e.target.value)} placeholder="•••-••-••••" />
          </label>
          <label className="text-xs text-charcoal-500 sm:col-span-2">
            Address
            <Input className="mt-1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="Street" />
          </label>
          <label className="text-xs text-charcoal-500">
            City
            <Input className="mt-1" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-charcoal-500">
              State
              <Input className="mt-1" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} />
            </label>
            <label className="text-xs text-charcoal-500">
              ZIP
              <Input className="mt-1" value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
            </label>
          </div>
        </div>
        <label className="mt-3 block text-xs text-charcoal-500">
          Upload W-9 (PDF)
          <input
            type="file"
            accept="application/pdf"
            className="mt-1 block w-full text-sm"
            onChange={(e) => setW9(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Completing…' : 'Complete setup'}
      </Button>
    </form>
  );
}
