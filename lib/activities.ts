/**
 * AppFolio staff activities — pure model (unit-tested).
 *
 * Source is the Reports API v2 `upcoming_activities` report (see
 * lib/activities-server.ts). It returns only Pending activities, overdue
 * included. There is no activity id, so links go to the tenant page
 * (/occupancies/{occupancy_id}), whose "Upcoming Activities" panel lists it;
 * owner/unit-less activities fall back to the property page.
 */

export const APPFOLIO_WEB_BASE = 'https://highdesertpm.appfolio.com';
export const ACTIVITIES_PAGE_URL = 'https://os.highdesertpm.com/activities';

/** Raw row shape of the upcoming_activities report (fields we use). */
export interface UpcomingActivityRow {
  activity_date: string | null;
  activity: string | null;
  activity_for: string | null;
  label: string | null;
  property_name: string | null;
  property_id: number | null;
  unit_address: string | null;
  unit_id: number | null;
  occupancy_id: number | null;
  status: string | null;
  assigned_user: string | null;
  created_by: string | null;
  created_on: string | null;
}

export interface Activity {
  date: string; // YYYY-MM-DD
  activity: string;
  activityFor: string | null;
  label: string | null;
  assignee: string | null; // display name, "(Hidden)" stripped
  assigneeHidden: boolean; // deactivated AppFolio user
  propertyName: string | null;
  unitAddress: string | null;
  createdBy: string | null;
  createdOn: string | null;
  link: string | null;
}

export type Bucket = 'overdue' | 'today' | 'next7' | 'later';
export const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'next7', 'later'];
export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  next7: 'Next 7 days',
  later: 'Later',
};

const HIDDEN_SUFFIX = /\s*\(hidden\)\s*$/i;

/** "Bianca Nyseth (Hidden)" → { name: "Bianca Nyseth", hidden: true }. */
export function normalizeAssignee(raw: string | null | undefined): { name: string | null; hidden: boolean } {
  const trimmed = raw?.trim();
  if (!trimmed) return { name: null, hidden: false };
  const hidden = HIDDEN_SUFFIX.test(trimmed);
  return { name: trimmed.replace(HIDDEN_SUFFIX, '').trim() || null, hidden };
}

/** Tenant page (where the activity is listed), else the property page, else null. */
export function activityLink(row: Pick<UpcomingActivityRow, 'occupancy_id' | 'property_id'>): string | null {
  // #upcoming_activities is the panel id on the tenant page; the browser scrolls to it.
  if (row.occupancy_id) return `${APPFOLIO_WEB_BASE}/occupancies/${row.occupancy_id}#upcoming_activities`;
  if (row.property_id) return `${APPFOLIO_WEB_BASE}/properties/${row.property_id}`;
  return null;
}

/** Trim and collapse runs of whitespace ("Nichole  A." → "Nichole A."); blank → null. */
const tidy = (s: string | null | undefined) => s?.replace(/\s+/g, ' ').trim() || null;

export function normalizeActivity(row: UpcomingActivityRow): Activity | null {
  if (!row.activity_date) return null;
  const { name, hidden } = normalizeAssignee(row.assigned_user);
  return {
    date: row.activity_date.slice(0, 10),
    activity: tidy(row.activity) ?? '(no description)',
    activityFor: tidy(row.activity_for),
    label: tidy(row.label),
    assignee: name,
    assigneeHidden: hidden,
    propertyName: tidy(row.property_name),
    unitAddress: tidy(row.unit_address),
    createdBy: tidy(row.created_by),
    createdOn: row.created_on?.slice(0, 10) || null,
    link: activityLink(row),
  };
}

/** Add whole days to a YYYY-MM-DD date (UTC arithmetic, no DST drift). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function bucketFor(date: string, today: string): Bucket {
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  if (date <= addDays(today, 7)) return 'next7';
  return 'later';
}

export type Buckets = Record<Bucket, Activity[]>;

/** Group by due bucket, each sorted oldest first. */
export function bucketActivities(rows: Activity[], today: string): Buckets {
  const out: Buckets = { overdue: [], today: [], next7: [], later: [] };
  for (const r of rows) out[bucketFor(r.date, today)].push(r);
  for (const b of BUCKET_ORDER) out[b].sort((a, z) => a.date.localeCompare(z.date) || a.activity.localeCompare(z.activity));
  return out;
}

const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Stable identity for an activity. The report has no activity id, so this is
 * a fingerprint of the fields that don't change while it's pending. Used to
 * announce each newly-appearing activity once.
 */
export function activityKey(a: Activity): string {
  return [a.date, a.assignee, a.activity, a.activityFor, a.unitAddress ?? a.propertyName, a.createdBy, a.createdOn].map(key).join('|');
}

/** Match an AppFolio assignee display name to a staff row by name, then person. */
export function staffForAssignee<T extends { person: string; name: string | null }>(
  assignee: string | null,
  staff: T[]
): T | null {
  const needle = key(assignee);
  if (!needle) return null;
  return staff.find((s) => key(s.name) === needle) ?? staff.find((s) => key(s.person) === needle) ?? null;
}

/** Activities assigned to a staff member (matched on staff.name, then person). */
export function activitiesForStaff(rows: Activity[], staff: { person: string; name: string | null }): Activity[] {
  const names = new Set([key(staff.name), key(staff.person)].filter(Boolean));
  return rows.filter((r) => names.has(key(r.assignee)));
}

// ============================================
// Slack DM (pure builders)
// ============================================

const DM_ITEM_LIMIT = 20; // keep the card well under Slack's 50-block cap

const mrkdwnSafe = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

function itemLine(a: Activity): string {
  const title = mrkdwnSafe(clip(a.activity, 150));
  const head = a.link ? `*<${a.link}|${title}>*` : `*${title}*`;
  const meta = [a.activityFor, a.unitAddress ?? a.propertyName].filter(Boolean).map((s) => mrkdwnSafe(s!)).join(' · ');
  return meta ? `${head}\n${meta}` : head;
}

export interface ActivitiesDm {
  text: string; // notification fallback — what the lock screen shows
  blocks: unknown[];
}

export type DmKind = 'morning' | 'nudge' | 'new';

/**
 * morning — items due today plus the overdue count; null when nothing is due
 *           today and nothing is overdue (no message, no ping).
 * nudge   — only the items still due today; null when none remain.
 * new     — `buckets.today` holds only activities that appeared since the
 *           last alert; null when there are none.
 */
export function buildActivitiesDm(
  buckets: Pick<Buckets, 'today' | 'overdue'>,
  opts: { kind: DmKind; date: string }
): ActivitiesDm | null {
  const { kind } = opts;
  const today = buckets.today;
  const overdue = kind === 'morning' ? buckets.overdue.length : 0;
  if (today.length === 0 && overdue === 0) return null;

  const activities = (n: number) => `${n} ${n === 1 ? 'activity' : 'activities'}`;
  const first = today[0] ? ` — ${clip(today[0].activity, 60)}${today[0].activityFor ? ` (${today[0].activityFor})` : ''}` : '';
  const text =
    kind === 'nudge'
      ? `⏰ Still due today: ${activities(today.length)}${first}`
      : kind === 'new'
        ? `🆕 New today: ${activities(today.length)}${first}`
        : `📋 ${today.length} due today · ${overdue} overdue${first}`;
  const header =
    kind === 'nudge' ? 'Still due today' : kind === 'new' ? 'New activity due today' : `Your AppFolio activities — ${opts.date}`;

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: header },
    },
  ];
  if (today.length) {
    for (const a of today.slice(0, DM_ITEM_LIMIT)) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: itemLine(a) } });
    }
    if (today.length > DM_ITEM_LIMIT) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `…and ${today.length - DM_ITEM_LIMIT} more due today` }] });
    }
  } else {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'Nothing due today.' } });
  }
  if (overdue > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `:warning: *${activities(overdue)} overdue*, still pending in AppFolio.` } });
  }
  blocks.push({
    type: 'actions',
    elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Activities' }, url: ACTIVITIES_PAGE_URL, action_id: 'activities:open' }],
  });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: "Links open the tenant's Upcoming Activities in AppFolio. Complete it there and it drops off this list." }] });
  return { text, blocks };
}
