'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import BrandButton from '@/components/referrals/BrandButton';

const fieldClass =
  'mt-1.5 block w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-brand-ink outline-none transition focus:border-brand-green focus:ring-2 focus:ring-brand-green/20';
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500';

/**
 * Submit a referral (Batch 3) — hdpm-web brand styling. Posts to
 * /api/partners/leads (RLS insert as this referrer + server-side dedupe).
 */
export default function NewLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState({ prospect_name: '', prospect_email: '', prospect_phone: '', address: '', unit_count: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch('/api/partners/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect_name: form.prospect_name,
          prospect_email: form.prospect_email || null,
          prospect_phone: form.prospect_phone || null,
          property_addresses: form.address ? [form.address] : null,
          unit_count: form.unit_count ? Number(form.unit_count) : null,
          notes: form.notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Submit failed');
      router.push('/partners/leads');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-greenDark">New referral</p>
      <h1 className="mt-1 font-brand-heading text-2xl font-extrabold tracking-tight text-brand-ink">Submit a referral</h1>
      <p className="mb-6 mt-1.5 text-sm text-neutral-500">Tell us about a property owner who might need management.</p>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <label className={labelClass}>
          Owner name *
          <input className={fieldClass} required value={form.prospect_name} onChange={(e) => setForm({ ...form, prospect_name: e.target.value })} />
        </label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Email
            <input className={fieldClass} type="email" value={form.prospect_email} onChange={(e) => setForm({ ...form, prospect_email: e.target.value })} />
          </label>
          <label className={labelClass}>
            Phone
            <input className={fieldClass} value={form.prospect_phone} onChange={(e) => setForm({ ...form, prospect_phone: e.target.value })} />
          </label>
        </div>
        <label className={labelClass}>
          Property address
          <input className={fieldClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className={labelClass}>
          Approx. unit count
          <input className={fieldClass} type="number" value={form.unit_count} onChange={(e) => setForm({ ...form, unit_count: e.target.value })} />
        </label>
        <label className={labelClass}>
          Notes
          <textarea className={fieldClass} rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2 pt-1">
          <BrandButton type="submit" disabled={busy || !form.prospect_name.trim()} withArrow>
            {busy ? 'Submitting…' : 'Submit referral'}
          </BrandButton>
          <BrandButton type="button" variant="ghost" onClick={() => router.push('/partners/leads')}>
            Cancel
          </BrandButton>
        </div>
      </form>
    </div>
  );
}
