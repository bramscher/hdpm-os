import { requireReferrer, getReferrerPartner } from '@/lib/referrals/referrer-context';
import BrandButton from '@/components/referrals/BrandButton';
import SignOutButton from './sign-out-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM — Referral dashboard' };

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ' +
        (ok ? 'bg-brand-green/10 text-brand-greenDark' : 'bg-amber-50 text-amber-700')
      }
    >
      {children}
    </span>
  );
}

/**
 * Referrer dashboard (Batch 2 shell, hdpm-web brand). Reads the referrer's own
 * partner row THROUGH RLS — proof the isolation works end-to-end.
 */
export default async function ReferrerDashboard() {
  const ctx = await requireReferrer();
  const partner = await getReferrerPartner(ctx);

  if (!partner) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-brand-heading text-lg font-extrabold tracking-tight text-brand-ink">Account not linked yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          You&apos;re signed in as {ctx.email}, but this login isn&apos;t linked to a referral partner record.
          Please use your invite link, or contact your HDPM representative.
        </p>
        <div className="mt-5">
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-greenDark">Partner dashboard</p>
          <h1 className="mt-1 font-brand-heading text-2xl font-extrabold tracking-tight text-brand-ink">Hi, {partner.display_name}</h1>
        </div>
        <SignOutButton />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Your referral code</div>
          <div className="mt-1 font-brand-heading text-2xl font-extrabold tracking-tight text-brand-ink">{partner.referral_code}</div>
          <p className="mt-2 text-xs text-neutral-400">
            Share links with <code className="rounded bg-neutral-100 px-1 py-0.5">?ref={partner.referral_code}</code> to get credited.
          </p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Status</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill ok={partner.status === 'active'}>{partner.status}</Pill>
            <Pill ok={!!partner.agreement_accepted_at}>{partner.agreement_accepted_at ? 'Agreement signed' : 'Agreement pending'}</Pill>
            <Pill ok={partner.w9_status !== 'missing'}>W-9 {partner.w9_status}</Pill>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <BrandButton href="/partners/leads" withArrow>
          View your referrals
        </BrandButton>
        <BrandButton href="/partners/leads/new" variant="outline">
          Submit a referral
        </BrandButton>
      </div>

      <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-400">
        Earnings appear here once fee payouts launch.
      </div>
    </div>
  );
}
