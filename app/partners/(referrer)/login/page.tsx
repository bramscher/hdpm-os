'use client';

import { useState } from 'react';
import BrandButton from '@/components/referrals/BrandButton';
import { createReferrerBrowserClient } from '@/lib/referrals/supabase-referrer-browser';

/**
 * Referrer login (Batch 2) — passwordless magic link, hdpm-web brand styling.
 */
export default function ReferrerLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const supabase = createReferrerBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/partners/auth/callback?next=/partners`,
          shouldCreateUser: false,
        },
      });
      // shouldCreateUser:false → Supabase errors "Signups not allowed for otp"
      // when the email isn't a provisioned referrer. Treat it like success so we
      // (a) don't leak which emails are registered and (b) don't show a scary
      // raw error to a partner who simply hasn't accepted their invite yet.
      if (error && !/signup|not allowed for otp/i.test(error.message)) throw error;
      setSent(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-brand-heading text-xl font-extrabold tracking-tight text-brand-ink">Check your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          If <span className="font-semibold text-brand-ink">{email}</span> is a registered referral partner, a
          secure sign-in link is on its way. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-6 text-center">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-greenDark">Referral Partners</p>
        <h1 className="mt-1 font-brand-heading text-3xl font-extrabold tracking-tight text-brand-ink">Partner sign in</h1>
        <p className="mt-2 text-sm text-neutral-500">We&apos;ll email you a secure sign-in link — no password needed.</p>
      </div>
      <form onSubmit={sendLink} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-7 shadow-sm">
        <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Email
          <input
            className="mt-1.5 block h-11 w-full rounded-lg border border-neutral-200 bg-white px-3.5 text-sm text-brand-ink outline-none transition focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <BrandButton type="submit" disabled={busy || !email.trim()} className="w-full" withArrow>
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </BrandButton>
      </form>
    </div>
  );
}
