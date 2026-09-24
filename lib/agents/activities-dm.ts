/**
 * Activities DM — Slack DMs of each person's AppFolio activities.
 *
 * - morning (7 AM): everything due today + the overdue count
 * - new (hourly, 8 AM–4 PM): activities due today that appeared since the
 *   person was last told — each one is announced once
 * - nudge (1 PM): whatever is still due today
 *
 * Every send is a NEW chat.postMessage (never chat.update), so Slack notifies
 * the recipient; the outbox `body` is the notification fallback text. There is
 * no per-day message cap: re-running a pass sends again. The only dedupe is
 * per activity for the hourly `new` pass, tracked through the `alerted_keys`
 * stored on today's outbox rows (AppFolio activities have a due date but no
 * time and no id, so "new" means newly appearing in the report).
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { todayPacific } from '@/lib/eos/escalation';
import { activitiesForStaff, activityKey, bucketActivities, buildActivitiesDm, type DmKind } from '@/lib/activities';
import { fetchActivities, loadActiveStaff } from '@/lib/activities-server';
import { enqueueOutbox, dispatchOutbox } from './outbox';
import { getAgentConfig, isGloballyKilled } from './config';
import { sendSlackMessage } from './channels/slack';

export const ACTIVITIES_AGENT = 'activities';
export const ACTIVITIES_DM_ACTION = 'daily_dm';

const SUBJECT: Record<DmKind, string> = { morning: 'Activities', nudge: 'Activities nudge', new: 'Activities new' };

export interface ActivitiesDmResult {
  date: string;
  kind: DmKind;
  dryRun: boolean;
  halted?: string;
  totalActivities: number;
  recipients: Array<{
    person: string;
    today: number;
    overdue: number;
    status: 'queued' | 'nothing_due' | 'no_slack_id' | 'dry_run';
    text?: string;
  }>;
  unmatchedAssignees: string[];
  dispatch?: unknown;
}

/** Keys of activities this recipient has already been told about today. */
async function alertedKeysToday(slackUserId: string, date: string): Promise<Set<string>> {
  const { data, error } = await getSupabaseAdmin()
    .from('agent_outbox')
    .select('payload')
    .eq('channel', 'slack')
    .eq('recipient_address', slackUserId)
    .eq('payload->>activities_date', date)
    .in('status', ['queued', 'sent']);
  if (error) throw new Error(`Activities outbox lookup failed: ${error.message}`);
  const keys = new Set<string>();
  for (const row of data ?? []) {
    const alerted = (row.payload as { alerted_keys?: unknown })?.alerted_keys;
    if (Array.isArray(alerted)) alerted.forEach((k) => typeof k === 'string' && keys.add(k));
  }
  return keys;
}

export async function runActivitiesDm(opts: {
  kind?: DmKind;
  dryRun?: boolean;
  only?: string | null;
  now?: Date;
} = {}): Promise<ActivitiesDmResult> {
  const now = opts.now ?? new Date();
  const kind = opts.kind ?? 'morning';
  const dryRun = opts.dryRun === true;
  const date = todayPacific(now);
  const result: ActivitiesDmResult = { date, kind, dryRun, totalActivities: 0, recipients: [], unmatchedAssignees: [] };

  if (await isGloballyKilled()) return { ...result, halted: 'global kill switch' };
  const config = await getAgentConfig(ACTIVITIES_AGENT, ACTIVITIES_DM_ACTION);
  if (config && !config.enabled) return { ...result, halted: 'activities/daily_dm disabled in agent_config' };

  // Always a fresh run: completed activities must drop off before we ping.
  const [{ rows }, staff] = await Promise.all([fetchActivities({ fresh: true }), loadActiveStaff()]);
  result.totalActivities = rows.length;

  const only = opts.only?.trim().toLowerCase();
  const targets = only
    ? staff.filter((s) => [s.person, s.name, s.email].some((v) => v?.toLowerCase() === only))
    : staff;

  const matched = new Set<string>();
  const subject = `${SUBJECT[kind]} — ${date}`;

  for (const person of targets) {
    const mine = activitiesForStaff(rows, person);
    if (mine.length === 0) continue;
    mine.forEach((a) => matched.add(a.assignee ?? ''));
    const buckets = bucketActivities(mine, date);
    const entry = { person: person.person, today: buckets.today.length, overdue: buckets.overdue.length };

    let dueToday = buckets.today;
    if (kind === 'new' && person.slack_user_id) {
      const seen = await alertedKeysToday(person.slack_user_id, date);
      dueToday = dueToday.filter((a) => !seen.has(activityKey(a)));
    }
    const dm = buildActivitiesDm({ today: dueToday, overdue: buckets.overdue }, { kind, date });
    if (!dm) {
      result.recipients.push({ ...entry, status: 'nothing_due' });
      continue;
    }
    if (!person.slack_user_id) {
      result.recipients.push({ ...entry, status: 'no_slack_id', text: dm.text });
      continue;
    }
    if (dryRun) {
      result.recipients.push({ ...entry, status: 'dry_run', text: dm.text });
      continue;
    }
    await enqueueOutbox({
      channel: 'slack',
      recipient_person: person.person,
      recipient_address: person.slack_user_id,
      subject,
      body: dm.text,
      payload: { blocks: dm.blocks, activities_date: date, kind, alerted_keys: dueToday.map(activityKey) },
    });
    result.recipients.push({ ...entry, status: 'queued', text: dm.text });
  }

  if (!only) {
    const assignees = new Set(rows.map((a) => a.assignee ?? '(unassigned)'));
    result.unmatchedAssignees = [...assignees].filter((a) => !matched.has(a) && a !== '').sort();
  }

  if (!dryRun && result.recipients.some((r) => r.status === 'queued')) {
    result.dispatch = await dispatchOutbox({ channel: 'slack', now });
  }
  return result;
}

/**
 * Preview: build one assignee's card (any AppFolio name, including departed
 * staff) and DM it to a single staff member — never to the assignee. Sent
 * directly (no outbox row), so it never affects the hourly `new` tracking.
 * `asOf` pretends "today" is another date so there is something due to show.
 */
export async function previewActivitiesDm(opts: {
  assignee: string;
  to: string;
  asOf?: string | null;
  kind?: DmKind;
}): Promise<{ sentTo: string; assignee: string; date: string; today: number; overdue: number; text: string | null; slack?: unknown }> {
  const kind = opts.kind ?? 'morning';
  const date = opts.asOf && /^\d{4}-\d{2}-\d{2}$/.test(opts.asOf) ? opts.asOf : todayPacific(new Date());
  const [{ rows }, staff] = await Promise.all([fetchActivities(), loadActiveStaff()]);
  const to = opts.to.trim().toLowerCase();
  const recipient = staff.find((s) => [s.person, s.name, s.email].some((v) => v?.toLowerCase() === to));
  if (!recipient?.slack_user_id) throw new Error(`No active staff member with a Slack id matches "${opts.to}"`);

  const needle = opts.assignee.trim().toLowerCase();
  const mine = rows.filter((a) => (a.assignee ?? '').toLowerCase() === needle);
  const buckets = bucketActivities(mine, date);
  const dm = buildActivitiesDm(buckets, { kind, date });
  const base = { sentTo: recipient.person, assignee: opts.assignee, date, today: buckets.today.length, overdue: buckets.overdue.length };
  if (!dm) return { ...base, text: null };

  const text = `[Preview of ${opts.assignee}'s card] ${dm.text}`;
  const blocks = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `:eyes: *Preview* — ${opts.assignee}'s ${kind} card as of ${date}. Only you received this.` }] },
    ...dm.blocks,
  ];
  const slack = await sendSlackMessage({ channel: recipient.slack_user_id, text, blocks });
  return { ...base, text, slack };
}
