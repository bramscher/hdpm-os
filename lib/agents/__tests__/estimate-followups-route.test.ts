import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const m=vi.hoisted(()=>({guard:vi.fn(),allowed:vi.fn(),rpc:vi.fn(),gather:vi.fn(),send:vi.fn(),killed:vi.fn(),config:vi.fn(),shadow:false,prior:[] as any[],outbox:[] as any[]}));
vi.mock('next/server',async original=>({...await original<any>(),after:()=>{}}));
vi.mock('@/lib/agents/followup-access',()=>({requireFollowupReviewer:m.guard,canReviewFollowups:m.allowed}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({rpc:m.rpc,from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,gte:()=>q,then:(resolve:any)=>Promise.resolve({data:table==='agent_outbox'?m.outbox:m.prior,error:null}).then(resolve)};return q;}})}));
vi.mock('@/lib/agents/estimate-followups',async original=>({...await original<any>(),gatherFollowups:m.gather}));
vi.mock('@/lib/agents/channels',()=>({getAdapter:()=>({send:m.send})}));
vi.mock('@/lib/agents/config',()=>({getAgentConfig:m.config,isGloballyKilled:m.killed}));
vi.mock('@/lib/agents/pilot',()=>({getPilotConfig:()=>({shadow:m.shadow}),getEstimateChaserOwner:()=> 'Penny'}));
vi.mock('@/lib/zoom-phone',()=>({isZoomSmsConfigured:()=>true,smsSenderEmail:()=> 'cheryl@highdesertpm.com'}));
import {POST} from '@/app/api/maintenance/estimate-followups/route';
import {followupSenders,followupDue} from '../followup-service';
const id='00000000-0000-4000-8000-000000000001';
const candidate=()=>({id,kind:'vendor',contextVersion:'source-v1',sourceUpdatedAt:new Date().toISOString()});
const invoke=(overrides:Record<string,unknown>={})=>POST(new NextRequest('http://localhost/api/maintenance/estimate-followups',{method:'POST',body:JSON.stringify({id,version:0,contextVersion:'source-v1',sender:followupSenders().email,op:'send',note:'',confirmed:true,channel:'email',recipient:'vendor@example.test',subject:'Bid ETA',body:'Please send the bid',...overrides})}));
beforeEach(()=>{
 vi.clearAllMocks();m.guard.mockResolvedValue({ok:true,email:'penny@highdesertpm.com'});m.allowed.mockResolvedValue(true);m.killed.mockResolvedValue(false);m.config.mockResolvedValue({enabled:true});m.shadow=false;m.prior=[];m.outbox=[];
 m.gather.mockResolvedValue([candidate()]);m.rpc.mockResolvedValue({data:{attempt_id:'attempt-1'},error:null});m.send.mockResolvedValue({status:'sent',message_id:'msg-1'});
 vi.stubEnv('RESEND_API_KEY','test');vi.stubEnv('AGENT_GRAPH_DRYRUN','0');vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('FOLLOWUP_SENDS_DRYRUN','');vi.stubEnv('AGENT_ZOOM_SMS_DRYRUN','0');
});
describe('shared reviewed send',()=>{
 it('blocks an unauthorized website request',async()=>{m.guard.mockResolvedValue({ok:false,response:NextResponse.json({error:'Forbidden'},{status:403})});expect((await invoke()).status).toBe(403);expect(m.send).not.toHaveBeenCalled();});
 it('rechecks the active reviewer at action time',async()=>{m.allowed.mockResolvedValue(false);expect((await invoke()).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();});
 it.each([{confirmed:false},{recipient:'bad'},{contextVersion:'old'},{sender:'wrong account'},{version:-1}])('rejects unsafe/stale input %j',async input=>{expect((await invoke(input)).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it('does not chase resolved work',async()=>{m.gather.mockResolvedValue([]);expect((await invoke()).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();});
 it('does not guess the decision-maker',async()=>{m.gather.mockResolvedValue([{...candidate(),kind:'decision'}]);expect((await invoke()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it('blocks stale source data',async()=>{m.gather.mockResolvedValue([{...candidate(),sourceUpdatedAt:'2020-01-01'}]);expect((await invoke()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it('respects preview and kill switches',async()=>{vi.stubEnv('VERCEL_ENV','preview');expect((await invoke()).status).toBe(409);vi.stubEnv('VERCEL_ENV','production');vi.stubEnv('FOLLOWUP_SENDS_DRYRUN','1');expect((await invoke()).status).toBe(409);vi.stubEnv('FOLLOWUP_SENDS_DRYRUN','');m.killed.mockResolvedValue(true);expect((await invoke()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it('sends a reviewed follow-up while the automatic chaser stays in shadow mode',async()=>{m.shadow=true;vi.stubEnv('AGENT_GRAPH_DRYRUN','1');expect((await invoke()).status).toBe(200);expect(m.send).toHaveBeenCalledTimes(1);});
 it('blocks duplicate approval before dispatch',async()=>{m.rpc.mockResolvedValue({data:null,error:{message:'Another teammate updated this item'}});expect((await invoke()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it.each(['email','sms_zoom'])('claims, sends once, and records %s',async channel=>{
  expect((await invoke({channel,sender:channel==='email'?followupSenders().email:followupSenders().sms,recipient:channel==='email'?'vendor@example.test':'+15415551234'})).status).toBe(200);
  expect(m.send).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][0]).toBe('estimate_followup_decide');expect(m.rpc.mock.calls[1]).toEqual(['estimate_followup_finish',{request:{id,attempt_id:'attempt-1',status:'sent',message_id:'msg-1'}}]);expect(m.rpc.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]);
 });
 it('records ambiguous delivery without retry',async()=>{m.send.mockRejectedValue(new Error('Timeout'));expect((await invoke()).status).toBe(409);expect(m.send).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[1][1].request.status).toBe('failed');});
 it('snoozes without external messaging',async()=>{expect((await invoke({op:'snooze',note:'Vendor promised Wednesday'})).status).toBe(200);expect(m.send).not.toHaveBeenCalled();});
 it('blocks a recent legacy send',async()=>{m.prior=[{id:'p1'}];m.outbox=[{status:'sent',sent_at:new Date().toISOString()}];expect((await invoke()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();});
 it('does not equate a legacy draft with a sent follow-up',async()=>{m.prior=[{id:'p1'}];m.outbox=[];expect((await invoke()).status).toBe(200);});
 it('keeps waiting separate from due and uncertain',()=>{expect(followupDue({status:'sent',next_review_at:'2099-01-01'} as any)).toBe(false);expect(followupDue({status:'uncertain'} as any)).toBe(false);expect(followupDue({status:'snoozed',next_review_at:'2000-01-01'} as any)).toBe(true);});
});
describe('vendor batch send',()=>{
 const id2='00000000-0000-4000-8000-000000000002';
 const two=()=>[{...candidate(),vendor:'Firkus',woNumber:'1'},{...candidate(),id:id2,vendor:'Firkus',woNumber:'2'}];
 const batch=(overrides:Record<string,unknown>={})=>POST(new NextRequest('http://localhost/api/maintenance/estimate-followups',{method:'POST',body:JSON.stringify({op:'send_vendor_batch',items:[{id,version:0,contextVersion:'source-v1'},{id:id2,version:0,contextVersion:'source-v1'}],sender:followupSenders().email,confirmed:true,recipient:'bids@firkus.test',subject:'Outstanding estimates',body:'Please send the bids',...overrides})}));
 it('claims every work order, sends one email, and records each',async()=>{
  m.gather.mockResolvedValue(two());m.rpc.mockImplementation(async(fn:string,args:any)=>({data:fn==='estimate_followup_decide'?{attempt_id:`a-${args.request.id.slice(-1)}`}:null,error:null}));
  const res=await batch();expect(res.status).toBe(200);expect(await res.json()).toEqual({sent:true,count:2});
  expect(m.send).toHaveBeenCalledTimes(1);
  const finishes=m.rpc.mock.calls.filter(c=>c[0]==='estimate_followup_finish').map(c=>c[1].request);
  expect(finishes).toEqual([{id,attempt_id:'a-1',status:'sent',message_id:'msg-1'},{id:id2,attempt_id:'a-2',status:'sent',message_id:'msg-1'}]);
 });
 it('rejects work orders from different vendors',async()=>{m.gather.mockResolvedValue([two()[0],{...two()[1],vendor:'Bend Radiant'}]);expect((await batch()).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();});
 it('rejects a single work order or non-vendor work',async()=>{
  m.gather.mockResolvedValue(two());expect((await batch({items:[{id,version:0,contextVersion:'source-v1'}]})).status).toBe(409);
  m.gather.mockResolvedValue([two()[0],{...two()[1],kind:'schedule'}]);expect((await batch()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();
 });
 it('releases earlier claims and sends nothing when a later claim fails',async()=>{
  m.gather.mockResolvedValue(two());let calls=0;
  m.rpc.mockImplementation(async(fn:string)=>fn==='estimate_followup_decide'?(++calls===1?{data:{attempt_id:'a-1'},error:null}:{data:null,error:{message:'Another teammate updated this item.'}}):{data:null,error:null});
  expect((await batch()).status).toBe(409);expect(m.send).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenLastCalledWith('estimate_followup_finish',{request:{id,attempt_id:'a-1',status:'skipped',error:'Batch cancelled before sending'}});
 });
 it('respects preview mode',async()=>{m.gather.mockResolvedValue(two());vi.stubEnv('VERCEL_ENV','preview');expect((await batch()).status).toBe(409);expect(m.rpc).not.toHaveBeenCalled();});
});
