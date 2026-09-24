import { describe, it, expect } from 'vitest';
import {
  activityKey,
  activityLink,
  activitiesForStaff,
  addDays,
  bucketActivities,
  bucketFor,
  buildActivitiesDm,
  normalizeActivity,
  normalizeAssignee,
  staffForAssignee,
  type Activity,
  type UpcomingActivityRow,
} from '../activities';

const row = (over: Partial<UpcomingActivityRow> = {}): UpcomingActivityRow => ({
  activity_date: '2026-09-24',
  activity: 'Contact owner re: renewal',
  activity_for: 'Sanford, Christine',
  label: 'Lease',
  property_name: 'Bernal Duplex',
  property_id: 1211,
  unit_address: '1051 E Cascade Ave Sisters, OR 97759',
  unit_id: 1771,
  occupancy_id: 8200,
  status: 'Pending',
  assigned_user: 'Jennifer Bertran',
  created_by: 'Mallory McCowen',
  created_on: '2026-09-01',
  ...over,
});

const act = (over: Partial<UpcomingActivityRow> = {}): Activity => normalizeActivity(row(over))!;

describe('normalizeAssignee', () => {
  it('strips the (Hidden) suffix for deactivated users', () => {
    expect(normalizeAssignee('Bianca Nyseth (Hidden)')).toEqual({ name: 'Bianca Nyseth', hidden: true });
  });
  it('passes plain names through and handles blanks', () => {
    expect(normalizeAssignee('Penny Free')).toEqual({ name: 'Penny Free', hidden: false });
    expect(normalizeAssignee(null)).toEqual({ name: null, hidden: false });
    expect(normalizeAssignee('  ')).toEqual({ name: null, hidden: false });
  });
});

describe('activityLink', () => {
  it('links to the tenant page when there is an occupancy', () => {
    expect(activityLink({ occupancy_id: 8450, property_id: 909 })).toBe('https://highdesertpm.appfolio.com/occupancies/8450#upcoming_activities');
  });
  it('falls back to the property page, then null', () => {
    expect(activityLink({ occupancy_id: null, property_id: 1211 })).toBe('https://highdesertpm.appfolio.com/properties/1211');
    expect(activityLink({ occupancy_id: null, property_id: null })).toBeNull();
  });
});

describe('normalizeActivity', () => {
  it('collapses doubled whitespace from AppFolio names', () => {
    expect(act({ activity_for: 'Johnson, Nichole  A. ' }).activityFor).toBe('Johnson, Nichole A.');
  });
  it('drops rows with no date', () => {
    expect(normalizeActivity(row({ activity_date: null }))).toBeNull();
  });
});

describe('bucketFor / bucketActivities', () => {
  const today = '2026-09-24';
  it('buckets around today and a 7-day window', () => {
    expect(bucketFor('2026-09-23', today)).toBe('overdue');
    expect(bucketFor(today, today)).toBe('today');
    expect(bucketFor('2026-09-25', today)).toBe('next7');
    expect(bucketFor('2026-10-01', today)).toBe('next7');
    expect(bucketFor('2026-10-02', today)).toBe('later');
  });
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });
  it('sorts each bucket oldest first', () => {
    const b = bucketActivities([act({ activity_date: '2026-09-20' }), act({ activity_date: '2026-07-08' })], today);
    expect(b.overdue.map((a) => a.date)).toEqual(['2026-07-08', '2026-09-20']);
  });
});

describe('staff matching', () => {
  const staff = [
    { person: 'Jennifer', name: 'Jennifer Bertran' },
    { person: 'Penny', name: null },
  ];
  it('matches on staff.name case-insensitively, then person', () => {
    expect(staffForAssignee('jennifer bertran', staff)?.person).toBe('Jennifer');
    expect(staffForAssignee('Penny', staff)?.person).toBe('Penny');
    expect(staffForAssignee('Kennedy James', staff)).toBeNull();
    expect(staffForAssignee(null, staff)).toBeNull();
  });
  it('filters activities to one staff member, including hidden-suffix names', () => {
    const rows = [act(), act({ assigned_user: 'Kennedy James' }), act({ assigned_user: 'Jennifer Bertran (Hidden)' })];
    expect(activitiesForStaff(rows, staff[0])).toHaveLength(2);
  });
});

describe('buildActivitiesDm', () => {
  const date = '2026-09-24';
  it('skips the morning DM when nothing is due or overdue', () => {
    expect(buildActivitiesDm({ today: [], overdue: [] }, { kind: 'morning', date })).toBeNull();
  });
  it('still sends the morning DM for overdue-only', () => {
    const dm = buildActivitiesDm({ today: [], overdue: [act(), act()] }, { kind: 'morning', date })!;
    expect(dm.text).toBe('📋 0 due today · 2 overdue');
  });
  it('puts the first item in the notification text', () => {
    const dm = buildActivitiesDm({ today: [act()], overdue: [act()] }, { kind: 'morning', date })!;
    expect(dm.text).toBe('📋 1 due today · 1 overdue — Contact owner re: renewal (Sanford, Christine)');
    expect(JSON.stringify(dm.blocks)).toContain('https://highdesertpm.appfolio.com/occupancies/8200#upcoming_activities');
  });
  it('nudges only when items are still due today', () => {
    expect(buildActivitiesDm({ today: [], overdue: [act()] }, { kind: 'nudge', date })).toBeNull();
    const dm = buildActivitiesDm({ today: [act(), act()], overdue: [] }, { kind: 'nudge', date })!;
    expect(dm.text.startsWith('⏰ Still due today: 2 activities')).toBe(true);
  });
  it('escapes Slack mrkdwn control characters', () => {
    const dm = buildActivitiesDm({ today: [act({ activity: 'Fix <door> & lock' })], overdue: [] }, { kind: 'morning', date })!;
    expect(JSON.stringify(dm.blocks)).toContain('Fix &lt;door&gt; &amp; lock');
  });
  it('announces only new items for the hourly pass, without the overdue line', () => {
    expect(buildActivitiesDm({ today: [], overdue: [act()] }, { kind: 'new', date })).toBeNull();
    const dm = buildActivitiesDm({ today: [act()], overdue: [act(), act()] }, { kind: 'new', date })!;
    expect(dm.text).toBe('🆕 New today: 1 activity — Contact owner re: renewal (Sanford, Christine)');
    expect(JSON.stringify(dm.blocks)).not.toContain('overdue');
  });
});

describe('activityKey', () => {
  it('is stable for the same activity and differs when a field changes', () => {
    expect(activityKey(act())).toBe(activityKey(act()));
    expect(activityKey(act())).not.toBe(activityKey(act({ activity_date: '2026-09-25' })));
    expect(activityKey(act())).not.toBe(activityKey(act({ unit_address: '2 Other St' })));
  });
});
