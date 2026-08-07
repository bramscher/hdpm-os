/**
 * Meeting Prep agent — orchestration (Phase 2, Brief 2D). Monday-morning
 * cron: ensure this week's L10 meeting row exists, assemble the prep
 * packet (scorecard deltas, aged issues, to-do done rate, recent
 * decisions, related history from the brain with citations), store it in
 * meeting.prep_packet_md, and DM the facilitator a link. Read-only
 * gathering + one bounded think() call — the agent prepares, never
 * decides (doc 06 §4, §9).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { collectCracks } from '@/lib/cracks';
import { createProposal } from '@/lib/agents/proposals';
import { enqueueOutbox, dispatchOutbox } from '@/lib/agents/outbox';
import { resolveStaffByPersonOrEmail } from '@/lib/agents/staff';
import { weekStartPacific, weeksBefore, offTrackStreak } from './scorecard';
import {
  buildAgenda,
  buildPrepPacket,
  defaultL10StartsAt,
  type PrepMetricLine,
  type PrepPacketInput,
} from './meeting';
import type { Meeting, ScorecardMetric, ScorecardEntry, Issue, Todo } from './types';

const ACTOR = 'agent:meeting_prep';
const FACILITATOR = 'Craig';
const APP_URL = 'https://hdpmchat.highdesertpm.com';
const PACKET_ISSUE_LIMIT = 10;

export interface MeetingPrepRunResult {
  weekStart: string;
  meetingId: string | null;
  meetingCreated: boolean;
  packetChars: number;
  memoryUsed: boolean;
  dmSent: boolean;
  dryRun: boolean;
}

/** Best-effort brain context for the packet — never blocks it (ops-brief pattern). */
async function packetMemoryContext(
  issueTitles: string[]
): Promise<PrepPacketInput['memory']> {
  if (issueTitles.length === 0) return null;
  try {
    const { think } = await import('@/lib/brain/think');
    const question =
      `What context, prior discussions, or decisions are relevant to this week's ` +
      `leadership meeting? Top open issues: ${issueTitles.slice(0, 3).join('; ')}`;
    const result = await think(question, { limit: 6, maxTokens: 500 });
    if (result.matches.length === 0) return null;
    return {
      answer: result.answer,
      links: result.sources.map((s) => ({ title: s.title, url: s.url })),
    };
  } catch (err) {
    console.warn('[meeting-prep] brain context unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function runMeetingPrep(opts: { dryRun?: boolean; now?: Date } = {}): Promise<MeetingPrepRunResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun === true;
  const supabase = getSupabaseAdmin();
  const weekStart = weekStartPacific(now);
  const weekEnd = weeksBefore(weekStart, -1); // Monday + 7d
  const result: MeetingPrepRunResult = {
    weekStart,
    meetingId: null,
    meetingCreated: false,
    packetChars: 0,
    memoryUsed: false,
    dmSent: false,
    dryRun,
  };

  // ── 1. This week's L10 (create if the calendar is empty) ──────────────
  const { data: existing, error: meetErr } = await supabase
    .from('meeting')
    .select('*')
    .eq('org_id', 'hdpm')
    .eq('kind', 'L10')
    .gte('starts_at', `${weekStart}T00:00:00Z`)
    .lt('starts_at', `${weekEnd}T00:00:00Z`)
    .order('starts_at')
    .limit(1)
    .maybeSingle();
  if (meetErr) throw new Error(`meeting read failed: ${meetErr.message}`);
  let meeting = existing as Meeting | null;
  if (!meeting && !dryRun) {
    const { data: created, error: createErr } = await supabase
      .from('meeting')
      .insert({
        kind: 'L10',
        starts_at: defaultL10StartsAt(weekStart),
        facilitator_person: FACILITATOR,
        agenda: buildAgenda('L10'),
      })
      .select('*')
      .single();
    if (createErr) throw new Error(`meeting create failed: ${createErr.message}`);
    meeting = created as Meeting;
    result.meetingCreated = true;
    await logAudit('meeting', meeting.id, 'created', ACTOR, { week_start: weekStart });
  }
  result.meetingId = meeting?.id ?? null;

  // ── 2. Gather ─────────────────────────────────────────────────────────
  const prevWeek = weeksBefore(weekStart, 1);
  const [metricsRes, entriesRes, issuesRes, openCountRes, todosRes, decisionsRes] =
    await Promise.all([
      supabase
        .from('scorecard_metric')
        .select('*')
        .eq('org_id', 'hdpm')
        .eq('active', true)
        .eq('cadence', 'weekly')
        .order('sort'),
      supabase
        .from('scorecard_entry')
        .select('*')
        .gte('week_start', weeksBefore(weekStart, 4)),
      supabase
        .from('issue')
        .select('*')
        .eq('org_id', 'hdpm')
        .in('status', ['open', 'discussed'])
        .order('priority')
        .order('created_at')
        .limit(PACKET_ISSUE_LIMIT),
      supabase
        .from('issue')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', 'hdpm')
        .in('status', ['open', 'discussed']),
      supabase
        .from('todo')
        .select('*')
        .eq('org_id', 'hdpm')
        .gte('due_on', prevWeek)
        .lt('due_on', weekStart),
      supabase
        .from('decision')
        .select('title, effective_on')
        .eq('org_id', 'hdpm')
        .gte('created_at', new Date(now.getTime() - 14 * 86_400_000).toISOString())
        .order('created_at', { ascending: false }),
    ]);

  const metrics = (metricsRes.data ?? []) as ScorecardMetric[];
  const entries = (entriesRes.data ?? []) as ScorecardEntry[];
  const issues = (issuesRes.data ?? []) as Issue[];
  const lastWeekTodos = (todosRes.data ?? []) as Todo[];

  const entriesByMetric = new Map<string, ScorecardEntry[]>();
  for (const e of entries) {
    if (!entriesByMetric.has(e.metric_id)) entriesByMetric.set(e.metric_id, []);
    entriesByMetric.get(e.metric_id)!.push(e);
  }
  const metricLines: PrepMetricLine[] = metrics.map((m) => {
    const rows = (entriesByMetric.get(m.id) ?? []).sort((a, b) =>
      b.week_start.localeCompare(a.week_start)
    );
    // The packet runs Monday morning — "current" is last week's number
    // (this week's entries don't exist until Friday's auto-fill).
    const current = rows.find((r) => r.week_start === prevWeek) ?? null;
    const prior = rows.find((r) => r.week_start === weeksBefore(weekStart, 2)) ?? null;
    return {
      name: m.name,
      unit: m.unit,
      goalOp: m.goal_op,
      goalValue: m.goal_value,
      ownerPerson: m.owner_person,
      current: current?.value ?? null,
      prior: prior?.value ?? null,
      onTrack: current?.on_track ?? null,
      offTrackStreak: offTrackStreak(rows),
    };
  });

  const today = new Date(`${weekStart}T12:00:00Z`);
  const issueLines = issues.map((i) => ({
    title: i.title,
    priority: i.priority,
    ageDays: Math.max(
      0,
      Math.round((today.getTime() - new Date(i.created_at).getTime()) / 86_400_000)
    ),
    raisedBy: i.raised_by,
  }));
  const doneCount = lastWeekTodos.filter((t) => t.status === 'done').length;

  const memory = await packetMemoryContext(issues.map((i) => i.title));
  result.memoryUsed = memory !== null;

  // Cracks Radar — best-effort; a collector failure never blocks the packet.
  let cracksTop: {
    label: string;
    detail: string;
    action: string | null;
    owner: string | null;
    ageDays: number;
  }[] = [];
  let crackTotal = 0;
  try {
    const report = await collectCracks(today);
    crackTotal = report.cracks.length;
    cracksTop = report.cracks
      .slice(0, 10)
      .map(({ label, detail, action, owner, ageDays }) => ({ label, detail, action, owner, ageDays }));
  } catch (err) {
    console.error('[meeting-prep] cracks collect failed:', err);
  }

  const packet = buildPrepPacket({
    weekStart,
    metrics: metricLines,
    issues: issueLines,
    openIssueCount: openCountRes.count ?? issues.length,
    todoStats: { due: lastWeekTodos.length, done: doneCount },
    recentDecisions: (decisionsRes.data ?? []).map((d) => ({
      title: d.title as string,
      effectiveOn: d.effective_on as string,
    })),
    memory,
    cracks: cracksTop,
    crackTotal,
  });
  result.packetChars = packet.length;

  if (dryRun || !meeting) {
    console.log('[meeting-prep]', JSON.stringify(result));
    return result;
  }

  // ── 3. Store + deliver ────────────────────────────────────────────────
  const { error: packetErr } = await supabase
    .from('meeting')
    .update({ prep_packet_md: packet })
    .eq('id', meeting.id);
  if (packetErr) throw new Error(`prep packet write failed: ${packetErr.message}`);
  await logAudit('meeting', meeting.id, 'prep_packet', ACTOR, {
    week_start: weekStart,
    packet_chars: packet.length,
    memory_used: result.memoryUsed,
  });
  const proposal = await createProposal({
    agent: 'meeting_prep',
    subject_type: 'meeting',
    subject_id: meeting.id,
    action_type: 'prep_packet',
    payload: { week_start: weekStart, packet_chars: packet.length, memory_used: result.memoryUsed },
    rationale: 'Monday meeting-prep packet (scorecard deltas, aged issues, brain context)',
  });

  const facilitator = meeting.facilitator_person ?? FACILITATOR;
  const staff = await resolveStaffByPersonOrEmail(facilitator);
  if (staff?.slack_user_id) {
    const meetingUrl = `${APP_URL}/company/meetings/${meeting.id}`;
    await enqueueOutbox({
      proposal_id: proposal.id,
      channel: 'slack',
      recipient_person: facilitator,
      recipient_address: staff.slack_user_id,
      subject: 'Meeting prep packet',
      body:
        `📋 *Meeting prep — week of ${weekStart}*\n` +
        `${issueLines.length} issues queued (${openCountRes.count ?? issueLines.length} open) · ` +
        `to-dos ${doneCount}/${lastWeekTodos.length} done last week.\n` +
        `Packet: ${meetingUrl}`,
      payload: { meeting_id: meeting.id, week_start: weekStart },
    });
    await dispatchOutbox({ channel: 'slack', now });
    result.dmSent = true;
  } else {
    console.warn(`[meeting-prep] no slack_user_id for ${facilitator} — packet stored, no DM`);
  }

  console.log('[meeting-prep]', JSON.stringify(result));
  return result;
}
