import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Users,
  UserCheck,
  FileWarning,
  GitBranch,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ScrollText,
  SlidersHorizontal,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { getReferralAdminStats } from '@/lib/referrals/dashboard';
import { listLeads } from '@/lib/referrals/leads';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Referral program' };

/**
 * Admin → Referral program home (Batch 4 UI). The overview hub: headline stats +
 * navigation into referrers, pipeline, and fee policy. Matches the HDPM-OS
 * stat-card language (see components/keys/KeysStatsCards).
 */
export default async function ReferralAdminHome() {
  const session = await auth();
  if (!session?.user?.isAdmin) redirect('/');

  const [stats, recent] = await Promise.all([getReferralAdminStats(), listLeads()]);
  const recentLeads = recent.slice(0, 6);

  const tiles = [
    { label: 'Active referrers', value: stats.referrersActive, sub: `${stats.referrersTotal} total`, icon: <UserCheck className="h-5 w-5" /> },
    { label: 'Open leads', value: stats.leadsOpen, sub: `${stats.leadsTotal} all-time`, icon: <GitBranch className="h-5 w-5" /> },
    { label: 'Referral / organic', value: `${stats.leadsReferral} / ${stats.leadsOrganic}`, sub: 'by source', icon: <Sparkles className="h-5 w-5" /> },
    { label: 'Suspected dupes', value: stats.suspectedDupes, sub: 'need review', icon: <AlertTriangle className="h-5 w-5" />, warn: stats.suspectedDupes > 0 },
    { label: 'W-9 missing', value: stats.w9Missing, sub: 'active referrers', icon: <FileWarning className="h-5 w-5" />, warn: stats.w9Missing > 0 },
  ];

  const sections = [
    { href: '/partners/admin/referrers', title: 'Referrers', desc: 'Create partners, mint codes, invite, set fee terms, pause.', icon: <Users className="h-5 w-5" /> },
    { href: '/partners/admin/leads', title: 'Pipeline', desc: 'Every owner lead — referral + organic. Work stages, resolve dupes, link AppFolio.', icon: <ScrollText className="h-5 w-5" /> },
    { href: '/partners/admin/fee-policy', title: 'Fee policy', desc: 'The Oregon compensation-eligibility switches. Enable a fee type after legal sign-off.', icon: <SlidersHorizontal className="h-5 w-5" /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Referral program"
        description="Owner-acquisition at a glance — referral partners, the lead pipeline, and compensation policy."
      />

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-sand-200 bg-white p-5 shadow-card">
            <div className="flex items-start gap-3">
              <div
                className={
                  'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ' +
                  (t.warn ? 'bg-amber-50 text-amber-600' : 'bg-sand-100 text-charcoal-500')
                }
              >
                {t.icon}
              </div>
              <div className="min-w-0">
                <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">
                  {t.label}
                </p>
                <p className="text-2xl font-bold tracking-tight text-charcoal-900">{t.value}</p>
                <p className="text-[11px] text-charcoal-400">{t.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Section navigation */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-xl border border-sand-200 bg-white p-5 shadow-card transition-all hover:shadow-card-hover"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-terra-50 text-terra-600">
                {s.icon}
              </div>
              <h3 className="text-base font-semibold text-charcoal-900">{s.title}</h3>
              <ArrowRight className="ml-auto h-4 w-4 text-charcoal-300 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-3 text-sm text-charcoal-500">{s.desc}</p>
          </Link>
        ))}
      </div>

      {/* Recent leads */}
      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-charcoal-800">Recent leads</h2>
          <Link href="/partners/admin/leads" className="text-sm text-charcoal-500 hover:underline">
            View all →
          </Link>
        </div>
        {recentLeads.length === 0 ? (
          <div className="rounded-xl border border-dashed border-sand-300 bg-white p-8 text-center text-sm text-charcoal-400">
            No leads yet. Create a referrer and submit one to see the pipeline fill in.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-card">
            <table className="w-full text-sm">
              <tbody>
                {recentLeads.map((l) => (
                  <tr key={l.id} className="border-b border-sand-100 last:border-0 hover:bg-sand-50">
                    <td className="px-4 py-3">
                      <Link href={`/partners/admin/leads/${l.id}`} className="font-medium text-charcoal-800 hover:underline">
                        {l.prospect_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={l.source === 'referral' ? 'terra' : 'neutral'}>{l.source}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{l.stage}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-charcoal-400">
                      {new Date(l.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
