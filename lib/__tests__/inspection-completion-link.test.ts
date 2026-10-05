import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const cascade = vi.hoisted(() => vi.fn(async () => ({ properties_updated: 1, next_created: 0 })));
vi.mock('../inspection-complete', () => ({ completeInspectionCascade: cascade }));
import { linkCompletionToUnit } from '../inspection-completion-link';

type Call = { table: string; ops: [string, unknown[]][] };
const op = (call: Call, name: string) => call.ops.find(([n]) => n === name)?.[1];

function fakeSupabase(rows: { inspection: Record<string, unknown> | null; unit: Record<string, unknown> | null }) {
  const calls: Call[] = [];
  const respond = (call: Call, single: boolean) => {
    if (call.table === 'inspections' && single) return { data: rows.inspection, error: null };
    if (call.table === 'inspection_properties' && single) {
      return { data: op(call, 'select')?.[0] === 'next_due_date' ? { next_due_date: '2027-04-05' } : rows.unit, error: null };
    }
    if (call.table === 'inspections' && op(call, 'select')?.[0] === 'id' && op(call, 'update')) return { data: [{ id: 'queued-1' }], error: null };
    return { data: null, error: null };
  };
  const client = {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: unknown = new Proxy({}, {
        get: (_, prop: string) => {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(respond(call, false));
          if (prop === 'maybeSingle') return async () => respond(call, true);
          return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const completed = { id: 'insp-1', property_id: 'stray-prop', status: 'completed', inspection_type: 'routine', completed_at: '2026-10-05T18:00:00Z' };
const unit = { id: 'unit-1', active: true, candidate_status: 'eligible' };

describe('linkCompletionToUnit', () => {
  beforeEach(() => cascade.mockClear());

  it('moves the visit to the chosen unit and credits it', async () => {
    const { client, calls } = fakeSupabase({ inspection: completed, unit });
    const result = await linkCompletionToUnit(client, 'insp-1', 'unit-1', 'craig@highdesertpm.com');
    expect(result).toMatchObject({ linked: true, from_property_id: 'stray-prop', property_id: 'unit-1', completed_on: '2026-10-05', follow_ups_moved: 1 });

    const writes = calls.filter((c) => c.table === 'inspections' && (op(c, 'update') || op(c, 'delete')));
    expect(op(writes[0], 'update')?.[0]).toMatchObject({ property_id: 'unit-1' });
    expect(op(writes[1], 'delete')).toBeDefined();
    expect(writes[1].ops).toContainEqual(['eq', ['property_id', 'stray-prop']]);
    expect(writes[1].ops).toContainEqual(['eq', ['last_inspection_date', '2026-10-05']]);
    expect(cascade).toHaveBeenCalledWith(client, ['insp-1'], '2026-10-05');
    expect(op(writes[2], 'update')?.[0]).toMatchObject({ due_date: '2027-04-05' });
    expect(writes[2].ops).toContainEqual(['eq', ['property_id', 'unit-1']]);
    expect(calls.some((c) => c.table === 'inspection_audit_log')).toBe(true);
  });

  it.each([
    ['not completed', { ...completed, status: 'scheduled' }, unit, 400],
    ['not routine', { ...completed, inspection_type: 'move_out' }, unit, 400],
    ['missing inspection', null, unit, 404],
    ['unknown unit', completed, null, 404],
    ['inactive unit', completed, { ...unit, active: false }, 400],
  ])('refuses when %s, before any write', async (_, inspection, target, status) => {
    const { client, calls } = fakeSupabase({ inspection, unit: target });
    const result = await linkCompletionToUnit(client, 'insp-1', 'unit-1', 'craig@highdesertpm.com');
    expect(result).toMatchObject({ status });
    expect(calls.some((c) => op(c, 'update') || op(c, 'delete') || op(c, 'insert'))).toBe(false);
    expect(cascade).not.toHaveBeenCalled();
  });
});
