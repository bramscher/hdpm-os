import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ tables: [] as string[], data: {} as Record<string, Record<string, unknown>[]> }));
vi.mock('@/lib/dashboard-config', () => ({ getDashboardConfig: async () => ({ internalVendorIds: ['internal'] }) }));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      mock.tables.push(table);
      let rows = mock.data[table] || [];
      const q: Record<string, unknown> = {};
      const self = () => q;
      Object.assign(q, { select: self, order: self, or: self, ilike: self, not: self, lte: self });
      q.eq = (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; };
      q.in = (key: string, value: unknown[]) => { rows = rows.filter(r => value.includes(r[key])); return q; };
      q.gte = (key: string, value: string) => { rows = rows.filter(r => typeof r[key] !== 'string' || (r[key] as string) >= value); return q; };
      q.range = async () => ({ data: rows, error: null });
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      return q;
    },
  }),
}));
import { fieldForReview, loadFieldDay } from '../server';

const actor = (person: string, role: string, office: boolean) => ({ person, name: person, email: `${person.toLowerCase()}@highdesertpm.com`, access_role: role, office, admin: role === 'admin', allowed: true });
const craig = actor('Craig', 'admin', true), brody = actor('Brody', 'pm', true), penny = actor('Penny', 'staff', true), alberto = actor('Alberto', 'maintenance', true);
const segment = (id: string, day: string, tech: string, kind: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  id, day_id: day, technician: tech, work_date: '2026-10-07', kind, started_at: `2026-10-07T${from}:00Z`, ended_at: `2026-10-07T${to}:00Z`,
  place_id: null, appfolio_property_id: null, appfolio_unit_id: null, property_label: 'Weinberger 284', inspection_stop_id: null,
  allocations: [], label: null, candidates: [], suggestion: null, state: 'confirmed', note: '', confirmed_by: 'x', confirmed_at: '2026-10-07T23:00:00Z', ...extra,
});

beforeEach(() => {
  mock.tables = [];
  mock.data = {
    field_day: [
      { id: 'd-alberto', technician: 'Alberto', work_date: '2026-10-07', source: 'device', sample_spec: null, version: 3, built_at: null },
      { id: 'd-sample', technician: 'Alberto', work_date: '2026-10-07', source: 'sample', sample_spec: { start: '08:00', end: '16:30', stops: [] }, version: 2, built_at: null },
      { id: 'd-brody', technician: 'Brody', work_date: '2026-10-07', source: 'device', sample_spec: null, version: 1, built_at: null },
    ],
    field_segment: [
      segment('s1', 'd-alberto', 'Alberto', 'on_site', '15:00', '18:00', { allocations: [{ work_order_id: 'wo-1', percent: 100 }] }),
      segment('s2', 'd-alberto', 'Alberto', 'drive', '18:00', '18:20'),
      segment('s3', 'd-alberto', 'Alberto', 'stop', '18:20', '19:00', { state: 'suggested' }),
      segment('s4', 'd-sample', 'Alberto', 'on_site', '15:00', '16:00', { allocations: [{ work_order_id: 'wo-1', percent: 100 }] }),
      segment('s5', 'd-brody', 'Brody', 'inspection', '15:00', '15:30'),
      segment('s6', 'd-brody', 'Brody', 'on_site', '15:30', '16:30', { allocations: [{ work_order_id: 'wo-2', percent: 100 }] }),
    ],
    field_place: [], inspection_properties: [], staff: [{ person: 'Brody', email: 'brody@highdesertpm.com' }],
    work_orders: [
      { id: 'wo-1', wo_number: '1-1', property_name: 'Weinberger 284', completed_date: '2026-10-07', status: 'done', appfolio_status: 'Completed', stage: null },
      { id: 'wo-2', wo_number: '2-1', property_name: 'Cedar Creek', completed_date: null, status: 'open', appfolio_status: 'Assigned', stage: null },
    ],
  };
});
const invoice = { id: 'i', invoice_code: 'HDMS-INV-000480', status: 'generated', doc_type: 'invoice', work_order_id: 'wo-1', wo_reference: null, line_items: [{ type: 'labor', qty: 1, amount: 95, description: 'Repair' }] } as never;
const review = (who: ReturnType<typeof actor>, extra: Partial<Parameters<typeof fieldForReview>[0]> = {}) =>
  fieldForReview({ actor: who, from: '2026-10-01', to: '2026-10-15', technician: '', sample: false, invoices: [invoice], decisions: [], today: '2026-10-16', ...extra });

describe('field day access', () => {
  it('refuses another tech and office reviewers, even though both techs count as office', async () => {
    await expect(loadFieldDay(brody, 'Alberto', '2026-10-07')).rejects.toThrow(/FORBIDDEN/);
    await expect(loadFieldDay(penny, 'Alberto', '2026-10-07')).rejects.toThrow(/FORBIDDEN/);
  });

  it('shows a tech their own device day, but never sample days or sample tools', async () => {
    const own = await loadFieldDay(alberto, 'Alberto', '2026-10-07');
    expect(own.source).toBe('device');
    expect(own.sources).toEqual(['device']);
    expect(own.sampleOptions).toBeNull();
    expect(own.segments.map(s => s.kind)).toEqual(['on_site', 'drive', 'stop']);
    await expect(loadFieldDay(alberto, 'Alberto', '2026-10-07', 'sample')).rejects.toThrow(/FORBIDDEN/);
  });

  it('gives an admin both sources, the sample spec and the sample tools, with no coordinates in segments', async () => {
    const day = await loadFieldDay(craig, 'Alberto', '2026-10-07', 'sample');
    expect(day.sources.sort()).toEqual(['device', 'sample']);
    expect(day.day?.sample_spec).toMatchObject({ start: '08:00' });
    expect(day.sampleOptions).not.toBeNull();
    expect(JSON.stringify(day.segments)).not.toMatch(/latitude|longitude|"lat"|"lng"/);
  });
});

describe('field time in Daily Billing Review', () => {
  it('gives a non-admin only their own job and parts minutes, and no billing items', async () => {
    const own = await review(brody, { technician: 'Alberto', sample: true });
    expect(own.source).toBe('device');
    expect([...own.days.values()]).toEqual([{ date: '2026-10-07', onSite: 60, parts: 0 }]);
    expect(own.issues).toEqual([]);
    expect(own.links).toEqual([{ technician: 'Brody', date: '2026-10-07' }]);
    expect(mock.tables).not.toContain('work_orders');
    const none = await review(penny);
    expect(none.days.size).toBe(0);
    expect(none.links).toEqual([]);
  });

  it('gives an admin every category and the not-fully-billed items', async () => {
    const all = await review(craig);
    expect(all.days.get('2026-10-07')).toMatchObject({ onSite: 240, inspection: 30, drive: 20, unlabeled: 40, unconfirmed: 40, technicians: ['Alberto', 'Brody'] });
    expect(all.issues.map(i => i.key)).toEqual(['wo:wo-1:field_time']);
    expect(all.issues[0].detail).toContain('About 2 h (~$190) is not billed.');
  });

  it('keeps sample days behind the admin toggle', async () => {
    const sample = await review(craig, { sample: true });
    expect(sample.source).toBe('sample');
    expect(sample.days.get('2026-10-07')).toMatchObject({ onSite: 60 });
    expect(sample.issues).toEqual([]);
  });
});
