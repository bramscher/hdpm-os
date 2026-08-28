'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Submit a referral (Batch 3). Posts to /api/partners/leads, which RLS-inserts
 * the lead as this referrer and then runs dedupe server-side.
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
      <h1 className="mb-1 text-xl font-semibold text-charcoal-900">Submit a referral</h1>
      <p className="mb-5 text-sm text-charcoal-500">Tell us about a property owner who might need management.</p>
      <form onSubmit={submit} className="space-y-4 rounded-xl border border-sand-200 bg-white p-5">
        <label className="block text-xs text-charcoal-500">
          Owner name *
          <Input className="mt-1" required value={form.prospect_name} onChange={(e) => setForm({ ...form, prospect_name: e.target.value })} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-charcoal-500">
            Email
            <Input className="mt-1" type="email" value={form.prospect_email} onChange={(e) => setForm({ ...form, prospect_email: e.target.value })} />
          </label>
          <label className="text-xs text-charcoal-500">
            Phone
            <Input className="mt-1" value={form.prospect_phone} onChange={(e) => setForm({ ...form, prospect_phone: e.target.value })} />
          </label>
        </div>
        <label className="block text-xs text-charcoal-500">
          Property address
          <Input className="mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="block text-xs text-charcoal-500">
          Approx. unit count
          <Input className="mt-1" type="number" value={form.unit_count} onChange={(e) => setForm({ ...form, unit_count: e.target.value })} />
        </label>
        <label className="block text-xs text-charcoal-500">
          Notes
          <textarea className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !form.prospect_name.trim()}>
            {busy ? 'Submitting…' : 'Submit referral'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push('/partners/leads')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
