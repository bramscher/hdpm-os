/**
 * Scorecard — orchestration (Phase 2, Brief 2B). Friday cron:
 *  1. Auto-fill this week's scorecard_entry for metrics_snapshot-sourced
 *     metrics (manual entries are never overwritten).
 *  2. Nudge owners of manual metrics that still have no entry this week
 *     (Slack DM linking to the Scorecard screen — entry happens there).
 *  3. Off-track two consecutive weeks → auto-file an issue (deduped by the
 *     open-source_ref unique index). Doc 06 §5 rung.
 * Every write audits (audit_event).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { readLatestMetrics } from '@/lib/agents/metrics-history';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import {
  weekStartPacific,
  weeksBefore,
  extractMetricValue,
  isOnTrack,
} from './scorecard';
import type { ScorecardMetric } from './types';

const ACTOR = 'agent:scorecard';
const SCREEN_URL = 'https://hdpmchat.highdesertpm.com/company/scorecard';

export interface ScorecardRunResult {
  weekStart: string;
  autoFilled: number;
  skippedManualOverride: number;
  missingValue: number;
  nudgesSent: number;
  issuesFiled: number;
  dryRun: boolean;
}

export async function runScorecardWeek(opts: { dryRun?: boolean; now?: Date } = {}): Promise<ScorecardRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const supabase = getSupabaseAdmin();
  const weekStart = weekStartPacific(now);
  const result: ScorecardRunResult = {
    weekStart,
    autoFilled: 0,
    skippedManualOverride: 0,
    missingValue: 0,
    nudgesSent: 0,
    issuesFiled: 0,
    dryRun,
  };

  const { data: metricRows, error } = await supabase
    .from('scorecard_metric')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('active', true)
    .eq('cadence', 'weekly');
  if (error) throw new Error(`scorecard_metric read failed: ${error.message}`);
  const metrics = (metricRows ?? []) as ScorecardMetric[];
  if (metrics.length === 0) return result;

  // Existing entries for this week (don't clobber manual numbers).
  const { data: existingRows } = await supabase
    .from('scorecard_entry')
    .select('metric_id, source')
    .eq('week_start', weekStart)
    .in('metric_id', metrics.map((m) => m.id));
  const existing = new Map((existingRows ?? []).map((r) => [r.metric_id, r.source]));

  // ── 1. Auto-fill from metrics_snapshot ────────────────────────────────
  const snapshotNames = [
    ...new Set(
      metrics
        .filter((m) => m.source === 'metrics_snapshot' && m.source_ref)
        .map((m) => (m.source_ref as string).split('.')[0])
    ),
  ];
  const snapshot = await readLatestMetrics(snapshotNames);

  for (const m of metrics) {
    if (m.source !== 'metrics_snapshot' || !m.source_ref) continue;
    if (existing.get(m.id) === 'manual') {
      result.skippedManualOverride++;
      continue;
    }
    const value = extractMetricValue(snapshot, m.source_ref);
    if (value === null) {
      result.missingValue++;
      console.warn(`[scorecard] no snapshot value for ${m.name} (${m.source_ref})`);
      continue;
    }
    const onTrack = isOnTrack(m.goal_op, m.goal_value, value);
    if (!dryRun) {
      const { error: upErr } = await supabase.from('scorecard_entry').upsert(
        {
          metric_id: m.id,
          week_start: weekStart,
          value,
          on_track: onTrack,
          source: 'auto',
          entered_by: 'system:scorecard',
        },
        { onConflict: 'metric_id,week_start' }
      );
      if (upErr) {
        console.error(`[scorecard] entry upsert failed (${m.name}):`, upErr.message);
        continue;
      }
      await logAudit('scorecard_entry', `${m.id}:${weekStart}`, 'auto_filled', ACTOR, {
        metric: m.name,
        value,
        on_track: onTrack,
      });
    }
    result.autoFilled++;
  }

  // ── 2. Manual metrics missing this week → owner nudge ─────────────────
  for (const m of metrics) {
    if (m.source !== 'manual' || existing.has(m.id) || !m.owner_person) continue;
    if (dryRun) {
      result.nudgesSent++;
      continue;
    }
    const owner = await resolveStaffByPersonOrEmail(m.owner_person);
    if (!owner?.slack_user_id) continue;
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: m.owner_person,
      recipient_address: owner.slack_user_id,
      subject: 'Scorecard number needed',
      body: `📊 Friday scorecard: *${m.name}* needs this week's number.\nEnter it here: ${SCREEN_URL}`,
      payload: { metric_id: m.id, week_start: weekStart },
    });
    result.nudgesSent++;
  }
  if (!dryRun && result.nudgesSent > 0) {
    await dispatchOutbox({ channel: 'slack', now });
  }

  // ── 3. Off-track 2 consecutive weeks → issue (deduped) ────────────────
  const prevWeek = weeksBefore(weekStart, 1);
  for (const m of metrics) {
    const { data: recent } = await supabase
      .from('scorecard_entry')
      .select('week_start, value, on_track')
      .eq('metric_id', m.id)
      .in('week_start', [weekStart, prevWeek])
      .order('week_start', { ascending: false });
    const rows = recent ?? [];
    const bothOff =
      rows.length === 2 && rows.every((r) => r.on_track === false);
    if (!bothOff) continue;
    if (dryRun) {
      result.issuesFiled++;
      continue;
    }
    const op = m.goal_op === 'gte' ? '≥' : '≤';
    const { data: issueRow, error: issueErr } = await supabase
      .from('issue')
      .insert({
        title: `Scorecard off-track 2 weeks: ${m.name}`,
        detail: `Goal ${op} ${m.goal_value} ${m.unit ?? ''}. Last two weeks: ${rows
          .map((r) => `${r.week_start}: ${r.value}`)
          .join(' · ')}. Owner: ${m.owner_person ?? 'unassigned'}.`,
        raised_by: ACTOR,
        source_ref: `scorecard_metric:${m.id}`,
        priority: 2,
      })
      .select('id')
      .single();
    if (issueErr) {
      // 23505 on the open-source_ref index = already an open issue. Correct.
      if (!/duplicate|unique/i.test(issueErr.message)) {
        console.error(`[scorecard] issue insert failed (${m.name}):`, issueErr.message);
      }
      continue;
    }
    await logAudit('issue', issueRow.id, 'created', ACTOR, {
      reason: 'scorecard_off_track_2w',
      metric: m.name,
    });
    result.issuesFiled++;
  }

  console.log('[scorecard]', JSON.stringify(result));
  return result;
}
