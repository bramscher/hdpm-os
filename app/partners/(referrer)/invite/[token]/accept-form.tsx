'use client';

import { useState } from 'react';
import BrandButton from '@/components/referrals/BrandButton';

const fieldClass =
  'mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green focus:ring-2 focus:ring-brand-green/20';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500';

/**
 * Accept form (Batch 2) — hdpm-web brand styling. Posts multipart to
 * /api/partners/invite/accept. The TIN is sent once over HTTPS and encrypted
 * server-side (never stored cleartext, never logged).
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
      <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-7">
        <h2 className="font-brand-heading text-xl font-extrabold tracking-tight text-brand-ink">You&apos;re all set</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-700">
          Your referral partner account is active. Sign in any time with a secure email link.
        </p>
        <div className="mt-5">
          <BrandButton href="/partners/login" withArrow>
            Go to sign in
          </BrandButton>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <label className={labelClass}>
          Your email (used to sign in)
          <input className={fieldClass + ' bg-neutral-50'} value={email} readOnly />
        </label>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-brand-heading text-base font-bold text-brand-ink">Referral agreement</h2>
        <p className="mb-2 text-xs text-neutral-400">Version {agreementVersion}</p>
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 text-xs leading-relaxed text-neutral-700">
          {agreementText}
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-sm text-neutral-700">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-green" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I have read and agree to the referral partner agreement.
        </label>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="font-brand-heading text-base font-bold text-brand-ink">Tax information</h2>
        <p className="mb-4 text-xs text-neutral-500">
          For your 1099-NEC. Your tax ID is encrypted and never shown again — we keep only the last 4 digits.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Legal name
            <input className={fieldClass} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </label>
          <label className={labelClass}>
            Tax ID (SSN or EIN)
            <input className={fieldClass} value={tin} onChange={(e) => setTin(e.target.value)} placeholder="•••-••-••••" />
          </label>
          <label className={labelClass + ' sm:col-span-2'}>
            Address
            <input className={fieldClass} value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} placeholder="Street" />
          </label>
          <label className={labelClass}>
            City
            <input className={fieldClass} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClass}>
              State
              <input className={fieldClass} value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} />
            </label>
            <label className={labelClass}>
              ZIP
              <input className={fieldClass} value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
            </label>
          </div>
        </div>
        <label className={labelClass + ' mt-4'}>
          Upload W-9 (PDF)
          <input
            type="file"
            accept="application/pdf"
            className="mt-1.5 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-ink hover:file:bg-neutral-200"
            onChange={(e) => setW9(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      <BrandButton type="submit" disabled={busy} className="w-full" size="lg" withArrow>
        {busy ? 'Completing…' : 'Complete setup'}
      </BrandButton>
    </form>
  );
}
