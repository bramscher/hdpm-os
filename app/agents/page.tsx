import { getSupabaseAdmin } from '@/lib/supabase';
import { auth } from '@/lib/auth';
import { listAgentConfig, isGloballyKilled } from '@/lib/agents/config';
import type { AgentProposal, OutboxMessage } from '@/lib/agents/types';
import AutonomyMatrix from '@/components/agents/AutonomyMatrix';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Agent Team',
};

/**
 * /agents — read-only Agent OS dashboard (staff session required via
 * middleware). The Slack cards are the action surface; this page is the
 * supervision surface: autonomy matrix, kill switch, proposal acceptance,
 * outbox health, and the Sep 4 write-path tracker.
 */

interface MetricValue {
  [key: string]: unknown;
}

async function loadData() {
  const supabase = getSupabaseAdmin();

  const [config, killed, proposalsRes, outboxRes, snapshotRes, baselineRes, clarificationsRes] = await Promise.all([
    listAgentConfig(),
    isGloballyKilled(),
    supabase
      .from('agent_proposal')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('agent_outbox')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('metrics_snapshot')
      .select('metric, value, captured_at')
      .neq('metric', 'baseline_freeze')
      .order('captured_at', { ascending: false })
      .limit(120),
    supabase
      .from('metrics_snapshot')
      .select('value, captured_at')
      .eq('metric', 'baseline_freeze')
      .order('captured_at', { ascending: true })
      .limit(1),
    supabase
      .from('brain_clarification')
      .select('id, question, context_ref, status, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const proposals = (proposalsRes.data ?? []) as AgentProposal[];
  const outbox = (outboxRes.data ?? []) as OutboxMessage[];

  // Latest snapshot row per metric.
  const latest = new Map<string, { value: MetricValue; captured_at: string }>();
  for (const row of snapshotRes.data ?? []) {
    if (!latest.has(row.metric)) {
      latest.set(row.metric, { value: row.value as MetricValue, captured_at: row.captured_at });
    }
  }

  return {
    config,
    killed,
    proposals,
    outbox,
    latest,
    baseline: baselineRes.data?.[0] ?? null,
    clarifications: (clarificationsRes.data ?? []) as BrainClarification[],
  };
}

interface BrainClarification {
  id: string;
  question: string;
  context_ref: string | null;
  status: string;
  created_at: string;
}

function proposalStats(proposals: AgentProposal[]) {
  const counts: Record<string, number> = {};
  for (const p of proposals) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const decided = (counts.approved ?? 0) + (counts.edited ?? 0) + (counts.rejected ?? 0);
  const accepted = (counts.approved ?? 0) + (counts.edited ?? 0);
  return {
    counts,
    decided,
    acceptanceRate: decided > 0 ? Math.round((accepted / decided) * 100) : null,
  };
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

const statusStyles: Record<string, string> = {
  proposed: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  edited: 'bg-green-100 text-green-800',
  auto_applied: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-sand-200 text-charcoal-600',
  queued: 'bg-amber-100 text-amber-800',
  sent: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-sand-200 text-charcoal-600',
};

function Pill({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status] ?? 'bg-sand-200 text-charcoal-600'}`}
    >
      {status}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white shadow-card p-4">
      <div className="text-xs uppercase tracking-wide text-charcoal-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-charcoal-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-charcoal-500">{sub}</div> : null}
    </div>
  );
}

export default async function AgentsPage() {
  const { config, killed, proposals, outbox, latest, baseline, clarifications } = await loadData();
  const session = await auth();
  const isAdmin = session?.user?.isAdmin === true;
  const stats = proposalStats(proposals);

  const retype = latest.get('appfolio_retype_touches')?.value;
  const actions = latest.get('staff_actions')?.value;
  const exceptions = latest.get('open_exceptions')?.value;
  const retype7 = num(retype?.last7Days);
  const target = num(retype?.weeklyTarget) ?? 40;

  const baselineExceptions = baseline
    ? num(
        ((baseline.value as MetricValue).metrics as Record<string, MetricValue> | undefined)?.open_exceptions
          ?.total
      )
    : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-display text-charcoal-900">Agent Team</h1>
        {killed ? (
          <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
            KILL SWITCH ON — all agents halted
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            agents active
          </span>
        )}
      </div>
      <p className="mb-6 text-sm text-charcoal-500">
        Supervision surface — the action surface is Slack. Autonomy changes are row updates in{' '}
        <code className="rounded bg-sand-100 px-1">agent_config</code>.
      </p>

      {/* Sep 4 tracker */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">
        Sep 4 write-path tracker
      </h2>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Retype touches / 7d"
          value={retype7 !== null ? String(retype7) : '—'}
          sub={`target ≥ ${target}/week to justify the Write API`}
        />
        <Stat
          label="Staff actions / 7d"
          value={actions ? String(num(actions.last7Days) ?? '—') : '—'}
          sub="baseline was ~0"
        />
        <Stat
          label="Open exceptions"
          value={exceptions ? String(num(exceptions.total) ?? '—') : '—'}
          sub={
            baselineExceptions !== null
              ? `baseline ${baselineExceptions}`
              : 'baseline not frozen yet'
          }
        />
        <Stat
          label="Proposal acceptance"
          value={stats.acceptanceRate !== null ? `${stats.acceptanceRate}%` : '—'}
          sub={`${stats.decided} decided · target > 80%`}
        />
      </div>

      {/* Autonomy matrix */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">
        Autonomy matrix
      </h2>
      <AutonomyMatrix initialConfig={config} isAdmin={isAdmin} />

      {/* Proposals */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">
        Recent proposals{' '}
        <span className="font-normal normal-case text-charcoal-400">
          (last {proposals.length} —{' '}
          {Object.entries(stats.counts)
            .map(([s, n]) => `${n} ${s}`)
            .join(' · ') || 'none yet'}
          )
        </span>
      </h2>
      <div className="mb-8 overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Decided by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {proposals.slice(0, 25).map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-3 py-2 text-charcoal-500">{fmtDate(p.created_at)}</td>
                <td className="px-3 py-2">{p.agent}</td>
                <td className="px-3 py-2">{p.action_type}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-charcoal-600">
                  {typeof (p.payload as MetricValue).item === 'string'
                    ? ((p.payload as MetricValue).item as string)
                    : `${p.subject_type} ${p.subject_id ?? ''}`}
                </td>
                <td className="px-3 py-2">
                  <Pill status={p.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-charcoal-500">{p.decided_by ?? '—'}</td>
              </tr>
            ))}
            {proposals.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-charcoal-400">
                  No proposals yet — the first Morning Action Card creates them.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Brain clarification queue (Brief 1C) */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">
        🧠 Brain clarification queue{' '}
        <span className="font-normal normal-case text-charcoal-400">
          (open questions from the nightly consolidation — answer in chat or a doc; corrections
          supersede)
        </span>
      </h2>
      <div className="mb-8 rounded-xl border border-sand-200 bg-white shadow-card">
        {clarifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-charcoal-400">
            No open questions — the brain has nothing it is unsure about.
          </p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {clarifications.map((c) => (
              <li key={c.id} className="px-3 py-3">
                <div className="text-sm text-charcoal-900">{c.question}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">
                  {fmtDate(c.created_at)}
                  {c.context_ref ? ` · ${c.context_ref}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Outbox */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-600">
        Outbox — last 20 messages
      </h2>
      <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-charcoal-500">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {outbox.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap px-3 py-2 text-charcoal-500">{fmtDate(m.created_at)}</td>
                <td className="px-3 py-2">{m.channel}</td>
                <td className="px-3 py-2">{m.recipient_person ?? m.recipient_address ?? '—'}</td>
                <td className="max-w-[16rem] truncate px-3 py-2 text-charcoal-600">{m.subject ?? '—'}</td>
                <td className="px-3 py-2">
                  <Pill status={m.status} />
                </td>
                <td className="max-w-[14rem] truncate px-3 py-2 text-xs text-red-600">{m.error ?? ''}</td>
              </tr>
            ))}
            {outbox.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-charcoal-400">
                  Nothing sent yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-xs text-charcoal-400">
        Baseline frozen: {baseline ? fmtDate(baseline.captured_at) : 'not yet — run the freeze curl before agents act'} ·
        Metrics refresh daily at 6:30 AM PT · Data: agent_config, agent_proposal, agent_outbox, metrics_snapshot
      </p>
    </div>
  );
}
