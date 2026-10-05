import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({review:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{email:'test@highdesertpm.com'}})}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:mocks.from})}));
vi.mock('@/lib/inspection-review-loader',()=>({loadInspectionReview:mocks.review,INSPECTION_REVIEW_CACHE_TAG:'test'}));
import { POST as schedule } from '@/app/api/inspections/candidates/schedule/route';
import { POST as buildRoutes } from '@/app/api/inspections/routes/route';
import { GET as stats } from '@/app/api/inspections/stats/route';
import { POST as addToQueue } from '@/app/api/inspections/candidates/queue/route';
const candidate=(id:string,review_group:string)=>({id,review_group,candidate_status:'eligible',next_due_date:'2026-09-01',latitude:44,longitude:-121});
const result=(candidates:ReturnType<typeof candidate>[],error:string|null=null)=>({rows:[],properties:candidates,candidates,review_counts:{ready:1,handled:1,confirmation:1},verification_error:error});
const request=(ids?:string[])=>new NextRequest('http://localhost/api/inspections/candidates/schedule',{method:'POST',body:JSON.stringify({date_range_start:'2026-10-05',date_range_end:'2026-10-19',candidate_ids:ids})});
describe('review groups gate scheduling and alerts',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-28T19:00:00Z'));mocks.from.mockImplementation(()=>{throw new Error('Unexpected database write');});});
  afterEach(()=>vi.useRealTimers());
  it.each(['handled','confirmation'])('rejects a manually selected %s candidate before writes',async group=>{
    mocks.review.mockResolvedValue(result([candidate('p',group)]));
    expect((await schedule(request(['p']))).status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.review.mock.calls[0][1]).toEqual({fresh:true});
  });
  it('auto-scheduling ignores uncertain and already handled candidates',async()=>{
    mocks.review.mockResolvedValue(result([candidate('p','confirmation'),candidate('done','handled')]));
    const response=await schedule(request());
    expect(response.status).toBe(200);
    expect((await response.json()).scheduled_count).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([schedule,buildRoutes])('blocks scheduling when verification is unavailable',async handler=>{
    mocks.review.mockResolvedValue(result([],'AppFolio verification unavailable'));
    expect((await handler(request())).status).toBe(503);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('also blocks uncertain routine inspections in the older route builder',async()=>{
    const data=result([candidate('p','confirmation')]);
    mocks.review.mockResolvedValue({...data,rows:[{id:'inspection',property_id:'p',inspection_type:'routine',inspection_properties:{address_1:'330 W 1st St #5'}}]});
    const response=await buildRoutes(new NextRequest('http://localhost/api/inspections/routes',{method:'POST',body:JSON.stringify({date_range_start:'2026-10-05',date_range_end:'2026-10-19',inspection_ids:['inspection']})}));
    expect(response.status).toBe(409);
    const body=await response.json();
    expect(body.error).toContain('330 W 1st St #5 (needs confirmation)');
    expect(body.blocked).toEqual([{id:'inspection',address:'330 W 1st St #5',reason:'Needs confirmation'}]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['handled','confirmation'])('Add to queue refuses a %s unit before writes',async group=>{
    mocks.review.mockResolvedValue(result([candidate('p',group)]));
    const response=await addToQueue(new NextRequest('http://localhost/api/inspections/candidates/queue',{method:'POST',body:JSON.stringify({candidate_ids:['p']})}));
    expect(response.status).toBe(409);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.review.mock.calls[0][1]).toEqual({fresh:true});
  });
  it('counts only ready candidates as overdue scheduling work',async()=>{
    mocks.review.mockResolvedValue(result([candidate('ready','ready'),candidate('uncertain','confirmation'),candidate('handled','handled')]));
    const query={select:()=>query,gte:()=>query,lt:async()=>({data:[],error:null})};
    mocks.from.mockReturnValue(query);
    const response=await stats();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({overdue:1,scheduling_alert:{total:1,overdue:1},review_counts:{ready:1,handled:1,confirmation:1}});
  });
});
