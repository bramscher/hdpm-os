import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { getTaxYear } from '@/lib/referrals/payouts-server';
import { pacificDate } from '@/lib/referrals/payouts';
import TinDownload from './tin-download';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Referral 1099s' };

const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

/** Admin → Partners → 1099s (Batch 8): paid bounties per referrer per tax year, and what each 1099-NEC still needs. */
export default async function Referral1099Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');
  const thisYear = Number(pacificDate(new Date()).slice(0, 4));
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) && requested >= 2024 && requested <= thisYear ? requested : thisYear;
  const { threshold, rows } = await getTaxYear(year).catch(() => ({ threshold: 0, rows: [] }));
  const needing = rows.filter((r) => r.overThreshold);
  const notReady = needing.filter((r) => !r.readiness.ready);
  const years = Array.from({ length: thisYear - 2024 + 1 }, (_, i) => thisYear - i);

  return (
    <PageContainer>
      <PageHeader
        title={`Referral 1099s · ${year}`}
        description={`Bounties paid to each referrer in ${year} (Pacific time). 1099-NEC threshold for ${year}: ${usd(threshold)}. Confirm with your accountant.`}
        actions={
          <>
            <a href="/partners/admin/payouts" className="text-sm text-charcoal-600 hover:underline">Payouts</a>
            <a href="/partners/admin/referrers" className="text-sm text-charcoal-600 hover:underline">Referrers</a>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {years.map((y) => (
          <a
            key={y}
            href={`/partners/admin/payouts/1099?year=${y}`}
            className={`rounded-full border px-3 py-1 text-sm ${y === year ? 'border-charcoal-900 bg-charcoal-900 text-white' : 'border-sand-200 bg-white text-charcoal-700'}`}
          >
            {y}
          </a>
        ))}
        <span className="ml-auto text-sm text-charcoal-500">
          {needing.length} need a 1099{notReady.length > 0 && <> · <strong className="text-amber-700">{notReady.length} missing info</strong></>}
        </span>
      </div>

      <div className="rounded-xl border border-sand-200 bg-white p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-charcoal-500">No bounties were paid in {year}.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-charcoal-400">
                <th className="py-2 pr-3">Payee</th>
                <th className="py-2 pr-3">TIN</th>
                <th className="py-2 pr-3 text-right">Paid in {year}</th>
                <th className="py-2 pr-3">1099-NEC</th>
                <th className="py-2">Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {rows.map((r) => (
                <tr key={r.partnerId}>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-charcoal-900">{r.payee}</div>
                    {r.payee !== r.displayName && <div className="text-xs text-charcoal-400">{r.displayName}</div>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.tinMasked || '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {usd(r.paid)} <span className="text-xs text-charcoal-400">({r.payments})</span>
                  </td>
                  <td className="py-2 pr-3">{r.overThreshold ? <Badge tone="terra">Required</Badge> : <span className="text-xs text-charcoal-400">Under threshold</span>}</td>
                  <td className="py-2">
                    {r.readiness.ready ? <Badge tone="success">Complete</Badge> : <Badge tone={r.overThreshold ? 'danger' : 'warning'}>Missing {r.readiness.missing.join(', ')}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rows.length > 0 && <TinDownload year={year} />}
    </PageContainer>
  );
}
