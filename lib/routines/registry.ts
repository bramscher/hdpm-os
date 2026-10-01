/**
 * Routine registry — one entry per vercel.json cron. The single place that
 * names a scheduled job, says who owns it and who hears from it, and ties it
 * back to the agent catalog. withCronRun (lib/cron/run.ts) looks routines up
 * here to label each run; /agents/routines draws its week grid from it.
 *
 * Adding a cron: add it to vercel.json AND here.
 * lib/routines/__tests__/registry.test.ts fails when the two drift apart.
 *
 * Schedules are the vercel.json strings verbatim, in UTC (Vercel runs crons
 * on UTC, so Pacific times drift an hour in winter).
 */

import { CronExpressionParser } from 'cron-parser';

export type RoutineCategory = 'sync' | 'agent' | 'report' | 'eos' | 'brain';

export interface Routine {
  /** Stable id stored in routine_run.routine_id. */
  id: string;
  /** Path + query exactly as vercel.json lists it. */
  path: string;
  /** Cron expression (UTC), verbatim from vercel.json. */
  schedule: string;
  name: string;
  category: RoutineCategory;
  /** Person responsible when it breaks. */
  owner: string;
  /** AGENT_CATALOG id, when the routine is (part of) a catalog agent. */
  catalogId?: string;
  /** agent_config row whose slack_recipients decide who hears from it. */
  notify?: { agent: string; action: string; fallback: string[] };
  /** Who hears from it, when it isn't agent_config driven. Empty = nobody (data only). */
  recipients?: string[];
}

export const ROUTINES: Routine[] = [
  // ── Syncs: pull data in, message nobody ───────────────────────────────
  { id: 'wo_sync_15m', path: '/api/sync/work-orders?days=1', schedule: '*/15 * * * *', name: 'Work orders sync (last day)', category: 'sync', owner: 'Craig' },
  { id: 'wo_sync_hourly', path: '/api/sync/work-orders?days=7', schedule: '0 * * * *', name: 'Work orders sync (last week)', category: 'sync', owner: 'Craig' },
  { id: 'appfolio_sync', path: '/api/sync/appfolio', schedule: '0 9 * * *', name: 'AppFolio properties sync', category: 'sync', owner: 'Craig' },
  { id: 'vacancies_sync', path: '/api/sync/vacancies', schedule: '0 15 * * *', name: 'Vacancies sync', category: 'sync', owner: 'Craig' },
  { id: 'keys_sync', path: '/api/sync/keys', schedule: '45 * * * *', name: 'Key assignments sync', category: 'sync', owner: 'Craig' },
  { id: 'af_reports_sync', path: '/api/sync/af-reports', schedule: '15 9 * * *', name: 'AppFolio reports sync', category: 'sync', owner: 'Craig' },
  { id: 'haven_sync', path: '/api/haven/sync', schedule: '45 13 * * *', name: 'Haven leads sync', category: 'sync', owner: 'Craig' },
  { id: 'reception_sync', path: '/api/reception/sync', schedule: '20 14 * * *', name: 'Zoom reception sync', category: 'sync', owner: 'Craig' },
  { id: 'zoom_contacts_sync', path: '/api/sync/zoom-contacts', schedule: '0 11 * * *', name: 'Zoom contacts sync', category: 'sync', owner: 'Craig' },
  { id: 'inspection_candidates', path: '/api/inspections/candidates/sync', schedule: '30 9 * * *', name: 'Inspection candidates sync', category: 'sync', owner: 'Brody' },
  { id: 'af_webhook_resolve', path: '/api/maintenance/cron/appfolio-webhook-resolve', schedule: '*/30 * * * *', name: 'AppFolio webhook resolver', category: 'sync', owner: 'Craig' },
  { id: 'hud_sync', path: '/api/sync/hud', schedule: '0 10 1 1 *', name: 'HUD fair market rents (yearly)', category: 'sync', owner: 'Craig' },
  { id: 'timekeeping_periods', path: '/api/timekeeping/cron', schedule: '10 8 * * *', name: 'Timekeeping periods', category: 'sync', owner: 'Craig' },
  { id: 'kpi_snapshot', path: '/api/kpi/cron', schedule: '0 14 * * *', name: 'KPI snapshot', category: 'sync', owner: 'Craig' },
  { id: 'maintenance_metrics', path: '/api/maintenance/cron/metrics', schedule: '30 13,21 * * *', name: 'Maintenance metrics snapshot', category: 'sync', owner: 'Craig' },

  // ── Brain / knowledge ─────────────────────────────────────────────────
  { id: 'knowledge_notion', path: '/api/sync/knowledge', schedule: '0 10 * * 0', name: 'Knowledge sync (Notion)', category: 'brain', owner: 'Craig' },
  { id: 'knowledge_onedrive', path: '/api/sync/knowledge?target=onedrive', schedule: '0 11 * * 0', name: 'Knowledge sync (OneDrive)', category: 'brain', owner: 'Craig' },
  { id: 'brain_evolve', path: '/api/brain/cron/evolve', schedule: '0 10 * * *', name: 'Knowledge Nightly Review', category: 'brain', owner: 'Craig' },
  { id: 'brain_snapshot', path: '/api/brain/cron/snapshot', schedule: '30 10 * * *', name: 'Brain map snapshot', category: 'brain', owner: 'Craig' },
  { id: 'ors_watch', path: '/api/sync/ors-watch', schedule: '0 12 1 * *', name: 'Oregon Law Watch', category: 'brain', owner: 'Craig', recipients: ['Craig'] },
  { id: 'ors_session_review', path: '/api/sync/ors-watch?sessionReview=1', schedule: '0 13 5 4,8 *', name: 'Oregon Law session review', category: 'brain', owner: 'Craig', recipients: ['Craig'] },

  // ── Agents ────────────────────────────────────────────────────────────
  { id: 'estimate_chaser', path: '/api/agents/cron/estimate-chaser', schedule: '45 13 * * 1-5', name: 'Stuck Estimate Chaser', category: 'agent', owner: 'Craig', catalogId: 'estimate_chaser', notify: { agent: 'estimate_chaser', action: 'vendor_chase', fallback: ['Craig'] } },
  { id: 'followup_queue', path: '/api/maintenance/cron/followups', schedule: '0 15,16 * * 1-5', name: 'Maintenance Follow-up Queue', category: 'agent', owner: 'Craig', catalogId: 'team_review', recipients: ['Penny', 'Craig'] },
  { id: 'ops_brief', path: '/api/agents/cron/ops-brief', schedule: '0 0 * * 2-6', name: 'Daily Ops Brief', category: 'agent', owner: 'Craig', catalogId: 'ops_brief', notify: { agent: 'ops_brief', action: 'send_brief', fallback: ['Brody', 'Matt', 'Craig'] } },
  { id: 'ops_brief_deep', path: '/api/agents/cron/ops-brief?deep=1', schedule: '0 15 * * 1', name: 'Monday Ops Brief (deep)', category: 'agent', owner: 'Craig', catalogId: 'ops_brief', notify: { agent: 'ops_brief', action: 'send_brief', fallback: ['Brody', 'Matt', 'Craig'] } },
  { id: 'activities_morning', path: '/api/agents/cron/activities', schedule: '0 14 * * 1-5', name: 'Activity Reminders (morning)', category: 'agent', owner: 'Craig', catalogId: 'activities', recipients: ['Each assignee'] },
  { id: 'activities_nudge', path: '/api/agents/cron/activities?kind=nudge', schedule: '0 20 * * 1-5', name: 'Activity Reminders (nudge)', category: 'agent', owner: 'Craig', catalogId: 'activities', recipients: ['Each assignee'] },
  { id: 'activities_new', path: '/api/agents/cron/activities?kind=new', schedule: '30 15-23 * * 1-5', name: 'Activity Reminders (new)', category: 'agent', owner: 'Craig', catalogId: 'activities', recipients: ['Each assignee'] },
  { id: 'operator_canary', path: '/api/agents/cron/operator-canary', schedule: '0 16 * * 1', name: 'AppFolio Form Filler health check', category: 'agent', owner: 'Craig', catalogId: 'dez_operator', recipients: ['Craig'] },

  // ── Reports ───────────────────────────────────────────────────────────
  { id: 'haven_digest', path: '/api/haven/cron/digest', schedule: '15 14 * * 1-5', name: 'Haven Daily Digest', category: 'report', owner: 'Craig', recipients: ['Brody', 'Matt'] },
  { id: 'tripwires', path: '/api/maintenance/cron/tripwires', schedule: '0 13 * * 1-5', name: 'Maintenance Tripwire Digest', category: 'report', owner: 'Craig', recipients: ['Work owners'] },
  { id: 'unbilled_report', path: '/api/maintenance/cron/unbilled-report', schedule: '0 14 * * 1', name: 'Unbilled Work Report', category: 'report', owner: 'Craig', recipients: ['Penny'] },

  // ── EOS ───────────────────────────────────────────────────────────────
  { id: 'eos_scorecard', path: '/api/eos/cron/scorecard', schedule: '0 22 * * 5', name: 'Scorecard Update (Friday)', category: 'eos', owner: 'Craig', recipients: ['Scorecard owners'] },
  { id: 'eos_scorecard_daily', path: '/api/eos/cron/scorecard-daily', schedule: '0 14 * * 1-5', name: 'Scorecard Update (daily)', category: 'eos', owner: 'Craig', recipients: ['Scorecard owners'] },
  { id: 'eos_escalation', path: '/api/eos/cron/escalation', schedule: '15 14 * * 1-5', name: 'Escalation Ladder', category: 'eos', owner: 'Craig', recipients: ['Leadership'] },
  { id: 'eos_meeting_prep', path: '/api/eos/cron/meeting-prep', schedule: '30 14 * * 1', name: 'L10 Meeting Prep', category: 'eos', owner: 'Craig', recipients: ['Facilitator'] },
];

export const routineById = (id: string) => ROUTINES.find((r) => r.id === id);

/**
 * Find the routine a request is running. Matches pathname plus the query
 * params the registry path names (extra params such as ?dryRun=1 are ignored),
 * preferring the entry that names the most params so `?days=7` beats the bare
 * path.
 */
export function routineForUrl(url: URL | string): Routine | undefined {
  const u = typeof url === 'string' ? new URL(url, 'http://x') : url;
  let best: Routine | undefined;
  let bestParams = -1;
  for (const r of ROUTINES) {
    const ru = new URL(r.path, 'http://x');
    if (ru.pathname !== u.pathname) continue;
    const params = [...ru.searchParams.entries()];
    if (!params.every(([k, v]) => u.searchParams.get(k) === v)) continue;
    if (params.length > bestParams) {
      best = r;
      bestParams = params.length;
    }
  }
  return best;
}

/** How often a routine fires: 'continuous' routines draw as one band, not dozens of blocks. */
export function cadence(schedule: string): 'continuous' | 'scheduled' {
  const [minute, hour] = schedule.trim().split(/\s+/);
  return minute.startsWith('*/') || hour === '*' ? 'continuous' : 'scheduled';
}

/** Every firing (UTC Date) of a schedule within [from, to). */
export function occurrences(schedule: string, from: Date, to: Date): Date[] {
  const it = CronExpressionParser.parse(schedule, { tz: 'UTC', currentDate: new Date(from.getTime() - 1) });
  const out: Date[] = [];
  while (out.length < 5000) {
    const next = it.next().toDate();
    if (next >= to) break;
    if (next >= from) out.push(next);
  }
  return out;
}

/** Next firing after `after`. */
export function nextRun(schedule: string, after: Date = new Date()): Date {
  return CronExpressionParser.parse(schedule, { tz: 'UTC', currentDate: after }).next().toDate();
}
