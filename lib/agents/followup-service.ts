import { getSupabaseAdmin } from '@/lib/supabase';
import { gatherFollowups, validateFollowupMessage, type FollowupCandidate, type FollowupReview } from './estimate-followups';
import { getAdapter } from './channels';
import { getAgentConfig, isGloballyKilled } from './config';
import { getPilotConfig } from './pilot';
import { isZoomSmsConfigured, smsSenderEmail } from '@/lib/zoom-phone';
import { canReviewFollowups } from './followup-access';
import type { OutboxMessage } from './types';
import { businessDaysBetween } from '@/lib/maintenance/business-days';
import { logAudit } from '@/lib/audit';

export function followupSenders() {
  return { email: process.env.AGENT_EMAIL_FROM || process.env.MAINT_DIGEST_FROM || 'HDPM Agents <maintenance@highdesertpm.com>',
    sms: `${smsSenderEmail()}${process.env.ZOOM_SMS_SENDER_NUMBER ? ` (${process.env.ZOOM_SMS_SENDER_NUMBER})` : ''}` };
}
export function followupDue(review?: FollowupReview, now = new Date()) {
  return !review || review.status === 'review' || (['snoozed','sent'].includes(review.status) && !!review.next_review_at && new Date(review.next_review_at) <= now);
}
async function rows(table: string, columns = '*', order = 'id') {
  const all: Record<string, any>[] = []; const db = getSupabaseAdmin();
  for(let start=0;;start+=1000) {
    const {data,error} = await db.from(table).select(columns).order(order).range(start,start+999);
    if(error) throw new Error(`${table}: ${error.message}`); all.push(...(data||[])); if((data||[]).length<1000) return all;
  }
}
export async function loadFollowupQueue() {
  const db=getSupabaseAdmin();
  const [candidates,reviews,events,legacy,config,killed,posted,staff] = await Promise.all([
    gatherFollowups(), rows('estimate_followup_review','*','work_order_id'), rows('estimate_followup_event'),
    db.from('agent_proposal').select('id,subject_id,action_type,status,created_at').eq('agent','estimate_chaser').in('action_type',['vendor_chase','vendor_chase_sms','owner_approval']).order('created_at',{ascending:false}).limit(1000),
    getAgentConfig('estimate_chaser','team_review'), isGloballyKilled(), db.from('maintenance_followup_slack').select('work_order_id').not('work_order_id','is',null),db.from('staff').select('person').eq('active',true).order('person'),
  ]);
  if(legacy.error) throw new Error(legacy.error.message);
  for(const c of candidates){const activity=legacy.data?.find(p=>p.subject_id===c.id);if(activity)c.legacyActivity=`Earlier ${activity.action_type} proposal: ${activity.created_at}. A draft does not confirm sending; check the conversation.`;}
  if(staff.error)throw new Error(staff.error.message);
  if(posted.error)throw new Error(posted.error.message);
  for(const c of candidates){const r=reviews.find(r=>r.work_order_id===c.id);c.newEpisode=!!r?.episode_key&&r.episode_key!==c.episodeKey&&!['sending','uncertain'].includes(r.status);}
  const known=new Set(candidates.map(c=>c.id));const missing=[...new Set([...reviews.map(r=>r.work_order_id),...(posted.data||[]).map(r=>r.work_order_id)])].filter(id=>!known.has(id));
  for(let i=0;i<missing.length;i+=150) {
    const {data,error}=await db.from('work_orders').select('id,property_name,unit_name,wo_number,vendor_name,description,owner_name,appfolio_status,synced_at').in('id',missing.slice(i,i+150));
    if(error)throw new Error(error.message);
    for(const w of data||[]) candidates.push({id:w.id,property:w.property_name,unit:w.unit_name||'',woNumber:w.wo_number||'',vendor:w.vendor_name||'',description:w.description||'',age:0,kind:'decision',reason:'No longer overdue in the estimate or unscheduled-work queue. History is retained.',email:'',phone:'',subject:'',emailBody:'',smsBody:'',eligible:false,owner:w.owner_name,sourceStatus:w.appfolio_status,sourceUpdatedAt:w.synced_at});
  }
  const preview=getPilotConfig().shadow || process.env.AGENT_GRAPH_DRYRUN==='1';
  const enabled=!!config?.enabled && !killed && !preview;
  return {candidates,staff:(staff.data||[]).map(s=>s.person as string),reviews:reviews as FollowupReview[],events:events.sort((a,b)=>b.id-a.id),legacy:legacy.data||[],senders:followupSenders(),
    available:{email:enabled && !!process.env.RESEND_API_KEY,sms:enabled && isZoomSmsConfigured() && process.env.AGENT_ZOOM_SMS_DRYRUN!=='1'},
    messagingStatus:killed?'Messaging paused':!config?.enabled?'Trial not activated':preview?'Preview mode — outbound sends disabled':'Human-reviewed sends enabled', loadedAt:new Date().toISOString()};
}
export async function decideFollowup(actor: string,input: Record<string,any>) {
  if(!await canReviewFollowups(actor)) throw new Error('This trial is reviewed by Penny and Craig.');
  if(!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input.id||'') || !Number.isInteger(input.version) || input.version<0 || !['send','snooze','dismiss','reopen','verified_sent','verified_unsent','note','help','reassign'].includes(input.op)) throw new Error('Invalid review action');
  if(typeof input.note!=='string' || input.note.length>2000)throw new Error('Team note must be under 2,000 characters');
  if(input.next_review_date && (!/^\d{4}-\d{2}-\d{2}$/.test(input.next_review_date) || input.next_review_date <= new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date())))throw new Error('Choose a future review date.');
  if(input.next_review_at && (!Number.isFinite(Date.parse(input.next_review_at)) || Date.parse(input.next_review_at)<=Date.now())) throw new Error('Choose a future review date.');
  const db=getSupabaseAdmin(); let message; let candidate:FollowupCandidate|undefined;
  if(input.op==='send') {
    if(input.confirmed!==true)throw new Error('Confirm the recipient and message before sending');
    message=validateFollowupMessage(input);
    const sender=message.channel==='email'?followupSenders().email:followupSenders().sms;
    if(input.sender!==sender)throw new Error('Sending account changed. Reopen the review before sending.');
    if(!(await getAgentConfig('estimate_chaser','team_review'))?.enabled)throw new Error('The shared trial is not activated');
    if(await isGloballyKilled())throw new Error('Messaging is paused');
    if(getPilotConfig().shadow || process.env.AGENT_GRAPH_DRYRUN==='1' || (message.channel==='sms_zoom' && process.env.AGENT_ZOOM_SMS_DRYRUN==='1'))throw new Error('Preview mode: no message sent');
    if(message.channel==='email' ? !process.env.RESEND_API_KEY : !isZoomSmsConfigured())throw new Error('Sending channel is not configured');
    candidate=(await gatherFollowups()).find(c=>c.id===input.id && c.eligible!==false);
    if(!candidate)throw new Error('This work order no longer needs this follow-up. Refresh the queue.');
    if(input.contextVersion!==candidate.contextVersion)throw new Error('Work-order context changed. Reopen the review.');
    if(candidate.kind==='decision')throw new Error('Confirm the decision-maker in the work order before sending a follow-up.');
    if(!candidate.sourceUpdatedAt || !Number.isFinite(Date.parse(candidate.sourceUpdatedAt)) || Date.now()-Date.parse(candidate.sourceUpdatedAt)>2*3600_000)throw new Error('Work-order data is more than two hours old or missing. Sync AppFolio before sending.');
    const {data:prior,error:priorError}=await db.from('agent_proposal').select('id').eq('agent','estimate_chaser').eq('subject_id',input.id).in('action_type',['vendor_chase','vendor_chase_sms','owner_approval']).gte('created_at',new Date(Date.now()-8*86400_000).toISOString());
    if(priorError)throw new Error(priorError.message);
    if(prior?.length){
      const {data:sent,error:sentError}=await db.from('agent_outbox').select('sent_at,status').in('proposal_id',prior.map(p=>p.id)).in('channel',['email','sms_zoom']).in('status',['sent','queued','failed']);
      if(sentError)throw new Error(sentError.message);
      if(sent?.some(s=>s.status!=='sent'||!s.sent_at||businessDaysBetween(new Date(s.sent_at),new Date())<3))throw new Error('A recent or unresolved legacy send exists. Check delivery history before another follow-up.');
    }
    // Outlook draft creation is not counted as a confirmed send.
  }
  if(!candidate)candidate=(await gatherFollowups()).find(c=>c.id===input.id);
  const {data:review,error}=await db.rpc('estimate_followup_decide',{actor,request:{id:input.id,version:input.version,op:input.op,note:input.note,owner_person:input.owner_person||null,episode_key:candidate?.episodeKey||null,next_review_at:input.next_review_at||null,next_review_date:input.next_review_date||null,...message}});
  if(error)throw new Error(error.message);
  if(input.op==='help') await fileFollowupHelp(input.id,actor,input.note);
  if(!message)return {review};
  let outcome;
  try {outcome=await getAdapter(message.channel).send({recipient_address:message.recipient,subject:message.subject,body:message.body,payload:{}} as OutboxMessage);}
  catch(e){outcome={status:'failed',error:(e as Error).message};}
  const finished=await db.rpc('estimate_followup_finish',{request:{id:input.id,attempt_id:review.attempt_id,...outcome}});
  if(finished.error)throw new Error('Delivery was attempted but could not be recorded. Check the sending account before retrying.');
  if(outcome.status!=='sent')throw new Error(outcome.error||'Delivery could not be confirmed. Check message history.');
  return {sent:true};
}
export async function fileFollowupHelp(id:string,actor:string,note:string) {
  const db=getSupabaseAdmin();const source=`wo:${id}:escalation`;
  const {data:existing,error:readError}=await db.from('issue').select('id').eq('source_ref',source).in('status',['open','discussed','parked']).limit(1);
  if(readError)throw new Error(readError.message);
  if(existing?.length)return;
  const {data:wo,error:woError}=await db.from('work_orders').select('wo_number,property_name,unit_name').eq('id',id).single();
  if(woError)throw new Error(woError.message);
  const {data,error}=await db.from('issue').insert({title:`Maintenance follow-up: WO ${wo.wo_number||''} — ${wo.property_name} ${wo.unit_name||''}`.slice(0,300),detail:note,raised_by:actor,source_ref:source,priority:2}).select('id').single();
  if(error && error.code!=='23505')throw new Error(error.message);
  if(data)await logAudit('issue',data.id,'created',actor,{source_ref:source,note});
}
