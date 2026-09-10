import { invitePartnerSummary } from '@/lib/referrals/onboarding';
import { AGREEMENT_TEXT, AGREEMENT_VERSION } from '@/lib/referrals/agreement';
import AcceptForm from './accept-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM — Accept your referral invite' };

/**
 * Invite accept page (Batch 2). Validates the token server-side (referrer is not
 * logged in yet), then renders the accept form: confirm email, accept the
 * agreement, provide W-9 + tax info. Onboarding links the Supabase Auth user.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const summary = await invitePartnerSummary(token);

  if (!summary) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-7 shadow-sm">
        <h1 className="font-brand-heading text-xl font-extrabold tracking-tight text-brand-ink">This invite can&apos;t be used</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          The link is invalid, expired, or has already been completed. Ask your HDPM contact for a fresh
          invite.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-brand-greenDark">Welcome</p>
        <h1 className="mt-1 font-brand-heading text-2xl font-extrabold tracking-tight text-brand-ink">{summary.display_name}</h1>
        <p className="mt-1.5 text-sm text-neutral-500">
          Complete your referral partner setup below — it takes a minute.
        </p>
      </div>
      <AcceptForm
        token={token}
        email={summary.email}
        agreementText={AGREEMENT_TEXT}
        agreementVersion={AGREEMENT_VERSION}
      />
    </div>
  );
}
