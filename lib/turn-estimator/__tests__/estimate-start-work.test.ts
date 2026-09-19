import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.guard }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdmin: () => ({from: mocks.from, rpc: mocks.rpc}) }));
import { POST } from '@/app/api/turn-estimator/estimates/[id]/start-work/route';

const invoke = () => POST(new NextRequest('https://example.test/api/start-work', {method:'POST'}), {params:Promise.resolve({id:'estimate-1'})});
function setup(status = 'approved', scope: {source_estimate_id:string}[][] = [[]]) {
  mocks.from.mockImplementation((table: string) => ({select: () => ({eq: () => table === 'estimate' ? {single: async () => ({data:{status,work_order_id:'wo-1'},error:null})} : Promise.resolve({data: scope.length > 1 ? scope.shift() : scope[0], error:null})})}));
  mocks.rpc.mockImplementation(async (_name, args) => args.request.op === 'job' ? {data:{id:'job-1'},error:null} : {data:{},error:null});
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ok:true,email:'office@example.test',role:'admin'});
  setup();
});
describe('estimate-to-job handoff', () => {
  it('rejects callers outside office roles before accessing data', async () => {
    mocks.guard.mockResolvedValue({ok:false,response:NextResponse.json({error:'Forbidden'},{status:403})});
    expect((await invoke()).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not create a job from unapproved scope', async () => {
    setup('approval_pending');
    expect((await invoke()).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('creates the job and imports approved scope through the guarded database function', async () => {
    expect(await (await invoke()).json()).toEqual({job_id:'job-1'});
    expect(mocks.rpc.mock.calls.map(call=>call[1].request.op)).toEqual(['job','import_estimate']);
  });
  it('reopens already imported scope without importing duplicate tasks', async () => {
    setup('approved', [[{source_estimate_id:'estimate-1'}]]);
    expect((await invoke()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts an identical concurrent import but preserves conflicts with other scope', async () => {
    setup('approved', [[], [{source_estimate_id:'estimate-1'}]]);
    mocks.rpc.mockImplementation(async (_name,args)=>args.request.op==='job'?{data:{id:'job-1'},error:null}:{data:null,error:{message:'Scope already exists'}});
    expect((await invoke()).status).toBe(200);
    setup('approved', [[{source_estimate_id:'different'}]]);
    mocks.rpc.mockImplementation(async (_name,args)=>args.request.op==='job'?{data:{id:'job-1'},error:null}:{data:null,error:{message:'Scope already exists'}});
    const conflict=await invoke();
    expect(conflict.status).toBe(400);
    expect((await conflict.json()).error).toBe('Scope already exists');
  });
});
