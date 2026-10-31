/**
 * Monthly growth report — one Slack DM to Craig on the 1st covering the
 * previous Pacific calendar month:
 *
 *   - Owner growth: website owner leads, consults / proposals / signed (from
 *     the website CRM's owner stages), and doors gained / lost / net (from the
 *     daily door_roster snapshots in kpi_snapshots).
 *   - Website leads by type.
 *   - Leasing: Haven conversations, tours, AppFolio conversions, reply time.
 *   - Main line: who answered (Zoom reception report) and Haven's hand-offs.
 *   - Needs a person now: open Haven escalations and pending follow-ups.
 *
 * Website lead numbers come from hdpm-web (/api/os/leads/report), which owns
 * the CRM. Each section degrades to "unavailable" on its own so one broken
 * source never blocks the rest of the report.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { todayPacific } from '@/lib/eos/escalation';
import { computeDoorMovement, type DoorMovement, type DoorRoster } from '@/lib/door-movement';
import { webAdminFetch } from '@/lib/hdpm-web-admin';

// ── Window ──────────────────────────────────────────────────────

export interface ReportWindow {
  /** e.g. "October 2026" */
  label: string;
  /** Pacific dates, end exclusive: "2026-10-01" … "2026-11-01" */
  startDate: string;
  endDate: string;
  /** UTC instants of Pacific midnight at startDate / endDate. */
  startIso: string;
  endIso: string;
}

/** UTC instant of Pacific midnight on the 1st of a month (DST-aware). */
function pacificMonthStart(year: number, month1: number): Date {
  const date = `${year}-${String(month1).padStart(2, '0')}-01`;
  for (const hour of [7, 8]) {
    const d = new Date(Date.UTC(year, month1 - 1, 1, hour));
    if (todayPacific(d) === date && todayPacific(new Date(d.getTime() - 1)) !== date) return d;
  }
  return new Date(Date.UTC(year, month1 - 1, 1, 8));
}

/** The Pacific calendar month before the one `now` falls in. */
export function previousMonthWindow(now: Date): ReportWindow {
  const [y, m] = todayPacific(now).split('-').map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const start = pacificMonthStart(prevY, prevM);
  const end = pacificMonthStart(y, m);
  const label = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(prevY, prevM - 1, 15)));
  return {
    label,
    startDate: todayPacific(start),
    endDate: todayPacific(end),
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

// ── Section data ────────────────────────────────────────────────

export interface WebsiteLeads {
  created: { total: number; byType: Record<string, number>; bySource: Record<string, number> };
  owner: {
    created: number;
    stillNew: number;
    unassigned: number;
    consultsBooked: number;
    proposalsSent: number;
    signed: number;
    signedNames: string[];
  };
}

export interface LeasingStats {
  conversations: number;
  fromWebsite: number;
  tours: number;
  converted: number;
  medianReplyMinutes: number | null;
  neverAnswered: number;
  topSources: Array<{ source: string; count: number }>;
}

export interface MainLineStats {
  inbound: number;
  answeredBy: Record<string, number>;
  handoffs: Record<string, number>;
}

export interface NeedsAttention {
  openEscalations: number;
  pendingFollowUps: number;
}

export interface MonthlyReportData {
  window: ReportWindow;
  website: WebsiteLeads | null;
  doors: DoorMovement | null;
  leasing: LeasingStats | null;
  mainLine: MainLineStats | null;
  attention: NeedsAttention | null;
}

const WEBSITE_RE = /web|highdesertpm/i;

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeLeasing(
  rows: Array<{
    lead_source: string | null;
    property_path: string | null;
    tour_scheduled: boolean | null;
    af_lead_status: string | null;
    response_seconds: number | null;
    first_inbound_at: string | null;
  }>
): LeasingStats {
  const sources = new Map<string, number>();
  for (const r of rows) {
    const s = r.lead_source || '(none)';
    sources.set(s, (sources.get(s) ?? 0) + 1);
  }
  const replies = rows.filter((r) => r.response_seconds != null).map((r) => r.response_seconds as number);
  const med = median(replies);
  return {
    conversations: rows.length,
    fromWebsite: rows.filter((r) => WEBSITE_RE.test(r.lead_source ?? '') || WEBSITE_RE.test(r.property_path ?? ''))
      .length,
    tours: rows.filter((r) => r.tour_scheduled).length,
    converted: rows.filter((r) => /converted/i.test(r.af_lead_status ?? '')).length,
    medianReplyMinutes: med == null ? null : Math.round((med / 60) * 10) / 10,
    neverAnswered: rows.filter((r) => r.first_inbound_at != null && r.response_seconds == null).length,
    topSources: [...sources.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count })),
  };
}

export function summarizeMainLine(
  rows: Array<{ kind: string; answered_by: string; haven_intent: string | null }>
): MainLineStats {
  const answeredBy: Record<string, number> = {};
  const handoffs: Record<string, number> = {};
  let inbound = 0;
  for (const r of rows) {
    if (r.kind === 'haven_transfer') {
      const intent = r.haven_intent || 'unknown';
      handoffs[intent] = (handoffs[intent] ?? 0) + 1;
    } else {
      inbound++;
      answeredBy[r.answered_by] = (answeredBy[r.answered_by] ?? 0) + 1;
    }
  }
  return { inbound, answeredBy, handoffs };
}

// ── Gathering (I/O) ─────────────────────────────────────────────

async function fetchWebsiteLeads(w: ReportWindow): Promise<WebsiteLeads | null> {
  const qs = new URLSearchParams({ from: w.startIso, to: w.endIso });
  const res = await webAdminFetch(`/leads/report?${qs}`, 'craig@highdesertpm.com');
  if (!res.ok) {
    console.warn('[monthly-report] website leads unavailable:', res.status);
    return null;
  }
  return (await res.json()) as WebsiteLeads;
}

/** Earliest door_roster snapshot at/after `iso`. */
async function rosterAt(supabase: SupabaseClient, iso: string): Promise<DoorRoster | null> {
  const { data } = await supabase
    .from('kpi_snapshots')
    .select('value')
    .eq('kpi_name', 'door_roster')
    .gte('captured_at', iso)
    .order('captured_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.value as { roster?: DoorRoster } | null)?.roster ?? null;
}

async function fetchDoors(supabase: SupabaseClient, w: ReportWindow): Promise<DoorMovement | null> {
  const [start, end] = await Promise.all([rosterAt(supabase, w.startIso), rosterAt(supabase, w.endIso)]);
  return start && end ? computeDoorMovement(end, start) : null;
}

async function fetchLeasing(supabase: SupabaseClient, w: ReportWindow): Promise<LeasingStats | null> {
  const { data, error } = await supabase
    .from('haven_conversation')
    .select('lead_source, property_path, tour_scheduled, af_lead_status, response_seconds, first_inbound_at')
    .gte('first_contact_at', w.startIso)
    .lt('first_contact_at', w.endIso);
  if (error) {
    console.warn('[monthly-report] haven_conversation read failed:', error.message);
    return null;
  }
  return summarizeLeasing(data ?? []);
}

async function fetchMainLine(supabase: SupabaseClient, w: ReportWindow): Promise<MainLineStats | null> {
  const { data, error } = await supabase
    .from('reception_call')
    .select('kind, answered_by, haven_intent')
    .gte('call_date', w.startDate)
    .lt('call_date', w.endDate);
  if (error) {
    console.warn('[monthly-report] reception_call read failed:', error.message);
    return null;
  }
  return summarizeMainLine(data ?? []);
}

async function fetchAttention(supabase: SupabaseClient): Promise<NeedsAttention | null> {
  const [esc, fu] = await Promise.all([
    supabase
      .from('haven_conversation')
      .select('conversation_id', { count: 'exact', head: true })
      .eq('escalation_flag', true)
      .not('flag_resolved', 'is', true),
    supabase
      .from('haven_conversation')
      .select('conversation_id', { count: 'exact', head: true })
      .eq('pending_follow_up', true),
  ]);
  if (esc.error || fu.error) return null;
  return { openEscalations: esc.count ?? 0, pendingFollowUps: fu.count ?? 0 };
}

export async function gatherMonthlyReport(supabase: SupabaseClient, now: Date): Promise<MonthlyReportData> {
  const window = previousMonthWindow(now);
  const settle = <T>(p: Promise<T | null>) =>
    p.catch((err) => {
      console.warn('[monthly-report] section failed:', err instanceof Error ? err.message : err);
      return null;
    });
  const [website, doors, leasing, mainLine, attention] = await Promise.all([
    settle(fetchWebsiteLeads(window)),
    settle(fetchDoors(supabase, window)),
    settle(fetchLeasing(supabase, window)),
    settle(fetchMainLine(supabase, window)),
    settle(fetchAttention(supabase)),
  ]);
  return { window, website, doors, leasing, mainLine, attention };
}

// ── Formatting ──────────────────────────────────────────────────

const UNAVAILABLE = '_unavailable this month_';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function counts(rec: Record<string, number>): string {
  const entries = Object.entries(rec).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(' · ') : 'none';
}

export function buildMonthlyReport(d: MonthlyReportData): {
  text: string;
  blocks: Array<Record<string, unknown>>;
} {
  const o = d.website?.owner;
  const owner = o
    ? [
        `• Owner leads from the website: *${o.created}*` +
          (o.stillNew ? ` (${o.stillNew} still at New, ${o.unassigned} unassigned)` : ''),
        `• Consults booked *${o.consultsBooked}* · proposals sent *${o.proposalsSent}* · *signed ${o.signed}*` +
          (o.signedNames.length ? ` — ${o.signedNames.join(', ')}` : ''),
      ]
    : [`• Website owner leads: ${UNAVAILABLE}`];
  const doors = d.doors
    ? `• Doors: *${signed(d.doors.net)} net* (gained ${d.doors.gained}, lost ${d.doors.lost}) → ${d.doors.currentDoors} total`
    : `• Doors: ${UNAVAILABLE} (needs a door_roster snapshot at both ends of the month)`;

  const web = d.website
    ? `• ${d.website.created.total} website leads: ${counts(d.website.created.byType)}`
    : `• ${UNAVAILABLE}`;

  const l = d.leasing;
  const leasing = l
    ? [
        `• ${l.conversations} Haven conversations (${l.fromWebsite} tagged from the website) · ${l.tours} tours · ${l.converted} became tenants`,
        `• Median first reply ${l.medianReplyMinutes ?? '–'} min · ${l.neverAnswered} never answered`,
        `• Top sources: ${l.topSources.map((s) => `${s.source} ${s.count}`).join(' · ') || 'none'}`,
      ]
    : [`• ${UNAVAILABLE}`];

  const m = d.mainLine;
  const mainLine = m
    ? [`• ${m.inbound} calls — answered by ${counts(m.answeredBy)}`, `• Haven hand-offs to staff: ${counts(m.handoffs)}`]
    : [`• ${UNAVAILABLE}`];

  const a = d.attention;
  const attention = a
    ? `• ${a.openEscalations} open Haven escalations · ${a.pendingFollowUps} pending follow-ups`
    : `• ${UNAVAILABLE}`;

  const sections: Array<[string, string[]]> = [
    ['Owner growth', [...owner, doors]],
    ['Website leads', [web]],
    ['Leasing (Haven)', leasing],
    ['Main line', mainLine],
    ['Needs a person now', [attention]],
  ];

  const title = `HDPM growth report — ${d.window.label}`;
  const text = [title, ...sections.map(([h, lines]) => `\n*${h}*\n${lines.join('\n')}`)].join('\n');
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: title } },
    ...sections.map(([h, lines]) => ({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${h}*\n${lines.join('\n')}` },
    })),
  ];
  return { text, blocks };
}
