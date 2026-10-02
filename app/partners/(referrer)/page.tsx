import { requireReferrer, getReferrerPartner } from '@/lib/referrals/referrer-context';
import BrandButton from '@/components/referrals/BrandButton';
import SignOutButton from './sign-out-button';
import { summarizeLedger } from '@/lib/referrals/bounty';
import type { LedgerEntry } from '@/lib/referrals/types';

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

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

  // Earnings (Batch 5), read through RLS: the policy only returns this referrer's own ledger rows.
  const { data: ledger } = await ctx.supabase.from('referral_ledger').select('entry_type, amount');
  const money = summarizeLedger((ledger ?? []) as Pick<LedgerEntry, 'entry_type' | 'amount'>[]);
  const hasEarnings = (ledger ?? []).length > 0;

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

      <section aria-label="Earnings">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Your earnings</div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Earned', value: money.earned },
            { label: 'Pending approval', value: money.pendingApproval },
            { label: 'Approved', value: money.approvedUnpaid },
            { label: 'Paid', value: money.paid },
          ].map((t) => (
            <div key={t.label} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="font-brand-heading text-xl font-extrabold tracking-tight text-brand-ink tabular-nums">{usd(t.value)}</div>
              <div className="mt-1 text-xs text-neutral-500">{t.label}</div>
            </div>
          ))}
        </div>
        {!hasEarnings && (
          <p className="mt-3 text-sm text-neutral-400">
            You earn a referral bounty when a referred owner signs a management agreement with us.
          </p>
        )}
      </section>
    </div>
  );
}
