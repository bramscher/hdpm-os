import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/turnover/server', () => ({ setComplete: vi.fn() }));

import { pickAdoptableTurn } from '../unit-turns';

const t = (vacated_at: string, af_service_request_id: string | null = 'sr-1', id = vacated_at) => ({ id, vacated_at, af_service_request_id });

describe('new turn work on a unit that is mid-turn', () => {
  it('joins the open turn: the five duplicates merged on 2026-11-06', () => {
    expect(pickAdoptableTurn([t('2026-09-22')], '2026-10-05')?.id).toBe('2026-09-22'); // BC 621 keys
    expect(pickAdoptableTurn([t('2026-10-18')], '2026-11-05')?.id).toBe('2026-10-18'); // Reindeer keys
    expect(pickAdoptableTurn([t('2026-10-08')], '2026-10-09')?.id).toBe('2026-10-08'); // Hatch remotes
    expect(pickAdoptableTurn([t('2026-07-20')], '2026-09-02')?.id).toBe('2026-07-20'); // Rhea keys, 44 days on
  });
  it('takes a turn with no service request yet first, as before', () => {
    expect(pickAdoptableTurn([t('2026-01-01'), t('2026-03-01', null, 'unkeyed')], '2026-03-02')?.id).toBe('unkeyed');
  });
  it('starts a new turn when the open one is too old or the move-out is well after the work', () => {
    expect(pickAdoptableTurn([t('2026-04-01')], '2026-11-05')).toBeNull();
    expect(pickAdoptableTurn([t('2026-12-01')], '2026-11-05')).toBeNull();
    expect(pickAdoptableTurn([], '2026-11-05')).toBeNull();
  });
  it('picks the closest when two open turns fit', () => {
    expect(pickAdoptableTurn([t('2026-09-01', 'a', 'far'), t('2026-10-01', 'b', 'near')], '2026-10-05')?.id).toBe('near');
  });
});
