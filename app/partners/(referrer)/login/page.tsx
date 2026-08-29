'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createReferrerBrowserClient } from '@/lib/referrals/supabase-referrer-browser';

/**
 * Referrer login (Batch 2) — passwordless magic link. Enter email → Supabase
 * emails a one-time link that lands on /partners/auth/callback and starts a
 * session. No password anywhere.
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
          shouldCreateUser: false, // referrers are provisioned via invite, not self-signup
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-charcoal-900">Check your email</h1>
        <p className="mt-2 text-sm text-charcoal-600">
          If <span className="font-medium">{email}</span> is a registered referral partner, a login link is
          on its way. Open it on this device to sign in.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-sand-200 bg-white p-6">
      <h1 className="text-lg font-semibold text-charcoal-900">Partner sign in</h1>
      <p className="mt-1 text-sm text-charcoal-500">We&apos;ll email you a secure sign-in link.</p>
      <form onSubmit={sendLink} className="mt-5 space-y-4">
        <label className="block text-xs text-charcoal-500">
          Email
          <Input
            className="mt-1"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <Button type="submit" disabled={busy || !email.trim()} className="w-full">
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </div>
  );
}
