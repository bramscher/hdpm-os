import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({queue:vi.fn(),decide:vi.fn(),allowed:vi.fn(),send:vi.fn(),update:vi.fn(),view:vi.fn(),after:[] as (()=>Promise<void>)[],rows:[] as any[]}));
vi.mock('next/server',async original=>({...await original<any>(),after:(fn:()=>Promise<void>)=>m.after.push(fn)}));
vi.mock('../followup-service',()=>({loadFollowupQueue:m.queue,decideFollowup:m.decide,fileFollowupHelp:vi.fn(),followupDue:(r:any)=>!r||r.status==='review'}));
vi.mock('../followup-access',()=>({FOLLOWUP_REVIEWERS:['penny@highdesertpm.com','craig@highdesertpm.com'],canReviewFollowups:m.allowed}));
vi.mock('../staff',()=>({resolveStaffBySlackId:async()=>({email:'penny@highdesertpm.com'}),resolveStaffByPersonOrEmail:async(email:string)=>({email,slack_user_id:email.startsWith('penny')?'UP':'UC'})}));
vi.mock('../config',()=>({getAgentConfig:async()=>({enabled:true}),isGloballyKilled:async()=>false}));
vi.mock('../channels/slack',()=>({sendSlackMessage:m.send,updateSlackMessage:m.update,splitSlackMessageId:(id:string)=>id?.includes(':')?{channel:id.split(':')[0],ts:id.split(':')[1]}:null}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:()=>{
 let filters:((r:any)=>boolean)[]=[],insert:any,patch:any;
 const run=()=>{let data=m.rows.filter(r=>filters.every(f=>f(r)));
  if(insert){if(m.rows.some(r=>r.reviewer_email===insert.reviewer_email&&r.message_key===insert.message_key))return {data:null,error:{code:'23505'}};const row={id:String(m.rows.length+1),state:'sending',...insert};m.rows.push(row);data=[row];}
  if(patch)data.forEach(r=>Object.assign(r,patch));
  return {data,error:null};};
 const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push(r=>r[k]===v);return q;},not:(k:string,_op:string,v:any)=>{filters.push(r=>r[k]!==v);return q;},insert:(v:any)=>{insert=v;return q;},update:(v:any)=>{patch=v;return q;},maybeSingle:async()=>{const r=run();return {...r,data:r.data?.[0]||null};},single:async()=>{const r=run();return {...r,data:r.data?.[0]||null};},then:(resolve:any)=>Promise.resolve(run()).then(resolve)};return q;
}})}));
import {followupCard,followupModal,handleFollowupInteraction,isFollowupInteraction,publishFollowupQueue,submissionInput} from '../followup-slack';
const candidate={id:'00000000-0000-4000-8000-000000000001',property:'Example property',unit:'B',woNumber:'1234',vendor:'Example Plumbing',description:'Kitchen faucet repair',age:6,kind:'vendor' as const,reason:'Waiting on bid',email:'vendor@example.test',phone:'+15415551234',subject:'Bid ETA',emailBody:'Please send the bid.',smsBody:'Please send the bid.',owner:'Penny',contextVersion:'v1'};
const q=()=>({candidates:[candidate],reviews:[],senders:{email:'maintenance@highdesertpm.com',sms:'Cheryl (+15415550000)'},available:{email:true,sms:true},messagingStatus:'Ready'});
beforeEach(()=>{vi.clearAllMocks();m.after=[];m.rows=[];m.queue.mockResolvedValue(q());m.allowed.mockResolvedValue(true);m.decide.mockResolvedValue({sent:true});m.send.mockImplementation(async()=>({status:'sent',message_id:`D1:${m.rows.length}.1`}));m.update.mockResolvedValue({status:'sent'});m.view.mockResolvedValue({ok:true,view:{id:'view1'}});vi.stubGlobal('fetch',async()=>({json:m.view}));vi.stubEnv('SLACK_BOT_TOKEN','test');});
describe('Slack reviewed chases',()=>{
 it('recognizes review submissions before the old block-action dispatcher',()=>{expect(isFollowupInteraction({type:'view_submission',view:{callback_id:'mf:submit'}})).toBe(true);expect(isFollowupInteraction({type:'view_submission',view:{callback_id:'other'}})).toBe(false);});
 it('shows sender, editable recipient and exact message before approval',()=>{const modal=followupModal(candidate,undefined,'email',q()) as any;expect(modal.submit.text).toBe('Send email');expect(JSON.stringify(modal)).toContain('maintenance@highdesertpm.com');expect(JSON.stringify(modal)).toContain('vendor@example.test');expect(JSON.stringify(modal)).toContain('Please send the bid.');expect(JSON.parse(modal.private_metadata).version).toBe(0);});
 it('keeps Slack content plain text and declines sending a decision-only item',()=>{expect(followupCard({...candidate,property:'<@everyone>'})[0].text.type).toBe('plain_text');expect((followupModal({...candidate,kind:'decision'},undefined,'email',q()) as any).submit).toBeUndefined();});
 it('does not offer send buttons for resolved or uncertain items',()=>{for(const [c,r] of [[{...candidate,eligible:false},undefined],[candidate,{status:'uncertain'}]] as any){const actions=followupCard(c,r).find(b=>b.type==='actions').elements;expect(actions.some((a:any)=>a.action_id==='mf:email')).toBe(false);}});
 it('parses review values and retains the captured source version and sender',()=>{const input=submissionInput({view:{private_metadata:JSON.stringify({id:candidate.id,version:3,contextVersion:'old',sender:'captured',mode:'email'}),state:{values:{body:{value:{value:'Edited message'}},recipient:{value:{value:'edited@example.test'}},confirm:{value:{selected_options:[{value:'confirmed'}]}}}}}});expect(input).toMatchObject({version:3,contextVersion:'old',sender:'captured',body:'Edited message',recipient:'edited@example.test',confirmed:true});});
 it('rejects an unapproved submission without scheduling a send',async()=>{const result=await handleFollowupInteraction({type:'view_submission',user:{id:'UP'},view:{private_metadata:JSON.stringify({mode:'email'}),state:{values:{}}}});expect((await result.json()).response_action).toBe('errors');expect(m.after).toHaveLength(0);expect(m.decide).not.toHaveBeenCalled();});
 it('limits the daily ask, persists cards, and does not repost on a cron retry',async()=>{
  const many=Array.from({length:10},(_,i)=>({...candidate,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,woNumber:String(i)}));m.queue.mockResolvedValue({...q(),candidates:many});
  const now=new Date('2026-09-21T15:00:00Z');const result=await publishFollowupQueue({now});expect(result.total).toBe(10);expect(m.send).toHaveBeenCalledTimes(16); // seven per reviewer plus their summaries
  await publishFollowupQueue({now});expect(m.send).toHaveBeenCalledTimes(16);expect(m.update).toHaveBeenCalledTimes(16);
 });
 it('does not automatically retry an uncertain initial Slack post',async()=>{m.send.mockResolvedValue({status:'failed',error:'Timeout'});await expect(publishFollowupQueue()).rejects.toThrow('Timeout');await expect(publishFollowupQueue()).rejects.toThrow('unconfirmed Slack');expect(m.send).toHaveBeenCalledTimes(1);});
 it('preview never writes or posts',async()=>{expect((await publishFollowupQueue({preview:true})).preview).toBe(true);expect(m.rows).toHaveLength(0);expect(m.send).not.toHaveBeenCalled();});
});
