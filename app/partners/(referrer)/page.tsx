import { requireReferrer, getReferrerPartner } from '@/lib/referrals/referrer-context';
import { Badge } from '@/components/ui/badge';
import SignOutButton from './sign-out-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM — Referral dashboard' };

/**
 * Referrer dashboard (Batch 2 shell). Reads the referrer's own partner row
 * THROUGH RLS (the JWT-bound client) — proof the isolation works end-to-end.
 * Leads, earnings, and lead submission arrive in Batch 3+.
 */
export default async function ReferrerDashboard() {
  const ctx = await requireReferrer();
  const partner = await getReferrerPartner(ctx);

  if (!partner) {
    return (
      <div className="rounded-xl border border-sand-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-charcoal-900">Account not linked yet</h1>
        <p className="mt-2 text-sm text-charcoal-600">
          You&apos;re signed in as {ctx.email}, but this login isn&apos;t linked to a referral partner
          record. Please use your invite link, or contact your HDPM representative.
        </p>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-charcoal-900">Hi, {partner.display_name}</h1>
          <p className="mt-1 text-sm text-charcoal-500">Your referral partner dashboard</p>
        </div>
        <SignOutButton />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-charcoal-400">Your referral code</div>
          <div className="mt-1 font-mono text-lg text-charcoal-900">{partner.referral_code}</div>
          <p className="mt-2 text-xs text-charcoal-400">
            Share links with <code>?ref={partner.referral_code}</code> to get credited (Batch 3).
          </p>
        </div>
        <div className="rounded-xl border border-sand-200 bg-white p-5">
          <div className="text-xs uppercase tracking-wide text-charcoal-400">Status</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={partner.status === 'active' ? 'success' : 'neutral'}>{partner.status}</Badge>
            <Badge tone={partner.agreement_accepted_at ? 'success' : 'warning'}>
              {partner.agreement_accepted_at ? 'Agreement signed' : 'Agreement pending'}
            </Badge>
            <Badge tone={partner.w9_status === 'missing' ? 'warning' : 'success'}>
              W-9 {partner.w9_status}
            </Badge>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-sand-300 bg-white p-5 text-sm text-charcoal-400">
        Lead submission and earnings appear here once they launch.
      </div>
    </div>
  );
}
