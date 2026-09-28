import { describe, expect, it, vi } from 'vitest';
import { inspectionHorizon, inspectionToday, inspectionScheduleError, currentCandidateStatus } from '../inspection-window';
import { classifyCandidate } from '../inspection-candidates';
import { getDueNotices } from '../inspection-notify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: 'test@highdesertpm.com' } }) }));
const db = vi.hoisted(() => ({ get: vi.fn(() => { throw new Error('Must reject before accessing database'); }) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: db.get }));
import { POST as scheduleCandidates } from '@/app/api/inspections/candidates/schedule/route';
import { POST as generateRoutes } from '@/app/api/inspections/routes/route';

const today = '2026-09-28';
describe('21-day inspection window', () => {
  it('includes the full 21st Pacific calendar day, including across DST and year boundaries', () => {
    expect(inspectionToday(new Date('2026-09-29T02:00:00Z'))).toBe(today);
    expect(inspectionHorizon(today)).toBe('2026-10-19');
    expect(inspectionHorizon('2026-10-25')).toBe('2026-11-15');
    expect(inspectionHorizon('2026-12-20')).toBe('2027-01-10');
    expect(inspectionScheduleError('2026-10-05','2026-10-19',today)).toBeNull();
    expect(inspectionScheduleError('2026-10-05','2026-10-20',today)).toMatch(/21 days/);
    expect(inspectionScheduleError('2026-10-04','2026-10-19',today)).toMatch(/7 days/);
    expect(inspectionScheduleError('2026-10-10','2026-10-05',today)).toMatch(/valid/);
    expect(inspectionScheduleError('2026-02-30','2026-10-05',today)).toMatch(/valid/);
  });
  it('reclassifies stale eligible candidates without altering terminal statuses', () => {
    expect(currentCandidateStatus('eligible','2026-10-19',today)).toBe('eligible');
    expect(currentCandidateStatus('eligible','2026-10-20',today)).toBe('defer');
    expect(currentCandidateStatus('eligible',null,today)).toBe('eligible');
    for (const status of ['scheduled','dismissed','skip_recent']) {
      expect(currentCandidateStatus(status,'2027-01-01',today)).toBe(status);
    }
  });
  it('applies the same boundary during candidate sync', () => {
    const input = { hasActiveTenant: true, lastInspectedDate: null, today: new Date('2026-09-29T02:00:00Z') };
    expect(classifyCandidate({...input,moveInDate:'2026-04-19'})).toBe('eligible');
    expect(classifyCandidate({...input,moveInDate:'2026-04-20'})).toBe('defer');
  });
  it.each([scheduleCandidates, generateRoutes])('rejects scheduling beyond the window before any database writes', async handler => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T19:00:00Z'));
    try {
      const response = await handler(new NextRequest('http://localhost/api/inspections/routes', {
        method:'POST', body:JSON.stringify({date_range_start:'2026-10-05',date_range_end:'2026-10-20'}),
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({error:'Routes can only be scheduled up to 21 days in advance.'});
      expect(db.get).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it.each([false,true])('limits notice lists including the legacy schema fallback (%s)', async legacy => {
    const dates = ['2026-09-27','2026-09-28','2026-10-19','2026-10-20'];
    let queries = 0;
    const supabase = { from: () => {
      queries++;
      let min = '', max = '9999';
      const query = {
        select: () => query, eq: () => query, is: () => query, not: () => query,
        gte: (_:string,date:string) => { min=date; return query; },
        lte: (_:string,date:string) => { max=date; return query; },
        order: () => query,
        limit: async () => legacy && queries === 1
          ? {data:null,error:{code:'42703'}}
          : {data:dates.filter(date=>date>=min && date<=max).map(date=>({id:date,target_date:date,inspection_properties:null})),error:null},
      };
      return query;
    }} as unknown as SupabaseClient;
    const result = await getDueNotices(supabase, { today:new Date('2026-09-29T02:00:00Z') });
    expect(result.notices.map(n=>n.target_date)).toEqual(['2026-09-28','2026-10-19']);
    expect(queries).toBe(legacy ? 2 : 1);
  });
});
