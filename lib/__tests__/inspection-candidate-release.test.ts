import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseScheduledCandidates } from '../inspection-candidate-release';

type Call = { table: string; ops: [string, unknown[]][] };
function fakeSupabase(propertyIds: (string | null)[]) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: unknown = new Proxy({}, {
        get: (_, prop: string) => {
          if (prop === 'then') {
            const data = table === 'inspections' ? propertyIds.map((property_id) => ({ property_id })) : null;
            return (resolve: (v: unknown) => void) => resolve({ data, error: null });
          }
          return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
        },
      });
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe('releaseScheduledCandidates', () => {
  it('resets only scheduled units, once per property', async () => {
    const { client, calls } = fakeSupabase(['prop-1', 'prop-1', 'prop-2', null]);
    await releaseScheduledCandidates(client, ['insp-1', 'insp-2', 'insp-3']);
    const update = calls.find((c) => c.table === 'inspection_properties');
    expect(update?.ops).toEqual([
      ['update', [{ candidate_status: 'eligible' }]],
      ['in', ['id', ['prop-1', 'prop-2']]],
      ['eq', ['candidate_status', 'scheduled']],
    ]);
  });
  it('does nothing without inspections', async () => {
    const { client, calls } = fakeSupabase([]);
    await releaseScheduledCandidates(client, []);
    expect(calls).toHaveLength(0);
  });
});
