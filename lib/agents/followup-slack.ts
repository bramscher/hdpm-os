import { after, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadFollowupQueue, followupDue, decideFollowup, fileFollowupHelp } from './followup-service';
import { FOLLOWUP_REVIEWERS, canReviewFollowups } from './followup-access';
import { resolveStaffBySlackId, resolveStaffByPersonOrEmail } from './staff';
import { sendSlackMessage, updateSlackMessage, splitSlackMessageId } from './channels/slack';
import { getAgentConfig, isGloballyKilled } from './config';
import type { FollowupCandidate, FollowupReview } from './estimate-followups';
import { todayPacific } from '@/lib/eos/escalation';

const HOME='https://hdpmchat.highdesertpm.com/company/issues';
const plain=(text:string)=>({type:'plain_text',text:text.slice(0,2900)});
const section=(text:string)=>({type:'section',text:plain(text)});
const safe=(text:string)=>text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!));
const button=(text:string,id:string,value:string)=>({type:'button',text:plain(text),action_id:id,value});
type Queue=Awaited<ReturnType<typeof loadFollowupQueue>>;

export function followupCard(c:FollowupCandidate,r?:FollowupReview) {
  const waiting=r?.next_review_at?`Next review: ${new Date(r.next_review_at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} PT`:'';
  const status=c.eligible===false?'No longer overdue':c.newEpisode?'New work-order episode — reopen review':r?.status||'Needs review';
  const blocks:any[]=[section(`WO ${c.woNumber||'—'} · ${c.property}${c.unit?` · ${c.unit}`:''}\n${c.description.slice(0,500)}`),section(`${c.reason}\nHDPM owner: ${c.owner||'Unassigned'} · Vendor: ${c.vendor||'Unassigned'}\n${c.sourceStatus||'Unknown source status'} · ${c.age} business days in this step\nReview: ${status}${waiting?` · ${waiting}`:''}`)];
  if(c.estimate)blocks.push(section(`Linked estimate: ${c.estimate.total===null?'Amount unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c.estimate.total)} · ${c.estimate.status} · version ${c.estimate.version??'draft'}`));
  if(c.legacyActivity)blocks.push(section(c.legacyActivity));
  if(r)blocks.push(section(`Last activity: ${r.updated_by} · ${r.status} · ${new Date(r.updated_at).toLocaleString('en-US',{timeZone:'America/Los_Angeles'})} PT\n${r.note||''}${r.error?`\n${r.error}`:''}`));
  const actions:any[]=[];
  if(c.eligible!==false && followupDue(r) && c.kind!=='decision') {
    actions.push(button('Review email','mf:email',c.id),button('Review text','mf:sms_zoom',c.id));
  }
  actions.push(button('Update / snooze','mf:manage',c.id),{type:'button',text:plain('Open shared queue'),url:`${HOME}?followup=${c.id}#maintenance-followups`,action_id:'mf:link'});
  blocks.push({type:'actions',elements:actions});
  blocks.push({type:'context',elements:[plain(`Source synced: ${c.sourceUpdatedAt||'unknown'}. No recorded reply does not prove no reply; check the conversation before sending.`)]});
  return blocks;
}
async function slackView(method:'views.open'|'views.update',body:Record<string,unknown>) {
  if(!process.env.SLACK_BOT_TOKEN)throw new Error('Slack is not configured');
  const response=await fetch(`https://slack.com/api/${method}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(method==='views.open'?2000:10000)});
  const result=await response.json();if(!result.ok)throw new Error(result.error||'Slack view failed');return result;
}
const resultView=(text:string)=>({type:'modal',title:plain('Maintenance follow-up'),close:plain('Close'),blocks:[section(text),{type:'section',text:{type:'mrkdwn',text:`<${HOME}|Open Company Issues>`}}]});
function input(id:string,label:string,value='',multiline=false,optional=false) {
  return {type:'input',block_id:id,label:plain(label),optional,element:{type:'plain_text_input',action_id:'value',multiline,...(value?{initial_value:value.slice(0,multiline?1600:200)}:{}),max_length:multiline?1600:200}};
}
export function followupModal(c:FollowupCandidate,review:FollowupReview|undefined,mode:string,q:Pick<Queue,'senders'|'available'|'messagingStatus'> & {staff?:string[]}) {
  const channel=mode==='sms_zoom'?'sms_zoom':'email';const sending=mode!=='manage';
  const sender=channel==='email'?q.senders.email:q.senders.sms;
  if(sending && (c.eligible===false || c.kind==='decision' || !followupDue(review)))return resultView('This follow-up is not ready to send. Open the shared queue to check its current status.');
  if(sending && !q.available[channel==='email'?'email':'sms'])return resultView(`${q.messagingStatus}. This sending channel is not available. No message has been sent.`);
  const metadata={id:c.id,version:review?.version||0,channel,sender,contextVersion:c.contextVersion,mode};
  const blocks:any[]=[section(`WO ${c.woNumber} · ${c.property}${c.unit?` · ${c.unit}`:''}\n${c.description.slice(0,450)}\n${c.reason}\nHDPM owner: ${c.owner||'Unassigned'}`)];
  if(c.legacyActivity)blocks.push(section(c.legacyActivity));
  if(sending) {
    blocks.push(section(`Send ${channel==='email'?'email':'text'} from: ${sender}\nReview the current conversation and edit the recipient and message before sending.`),input('recipient','Recipient',channel==='email'?c.email:c.phone));
    if(channel==='email')blocks.push(input('subject','Subject',c.subject));
    blocks.push(input('body','Message',channel==='email'?c.emailBody:c.smsBody,true),{type:'input',block_id:'confirm',label:plain('Approval'),element:{type:'checkboxes',action_id:'value',options:[{text:plain('I checked the conversation, recipient and message. Send this follow-up.'),value:'confirmed'}]}});
  } else {
    const options=[['note','Record call / reply'],['snooze','Snooze'],['help','Request help'],['reassign','Reassign HDPM owner'],['dismiss','No follow-up needed'],['reopen','Reopen review'],['verified_sent','Delivery checked: sent'],['verified_unsent','Delivery checked: not sent']].map(([value,text])=>({text:plain(text),value}));
    blocks.push({type:'input',block_id:'op',label:plain('Action'),element:{type:'static_select',action_id:'value',options,initial_option:options[0]}}, {type:'input',block_id:'date',optional:true,label:plain('Next review (8 AM Pacific; defaults to 3 business days)'),element:{type:'datepicker',action_id:'value'}});
  }
  if(!sending && q.staff?.length)blocks.push({type:'input',optional:true,block_id:'owner',label:plain('New HDPM owner (for reassign)'),element:{type:'static_select',action_id:'value',options:q.staff.slice(0,100).map(person=>({text:plain(person),value:person}))}});
  blocks.push(input('note',sending?'Optional team note':'Team note / outcome','',true,sending));
  return {type:'modal',callback_id:'mf:submit',private_metadata:JSON.stringify(metadata),title:plain('Review follow-up'),submit:plain(sending?(channel==='email'?'Send email':'Send text'):'Save review'),close:plain('Cancel'),blocks};
}
function stateValue(payload:any,id:string) {return payload.view?.state?.values?.[id]?.value;}
export function submissionInput(payload:any) {
  const meta=JSON.parse(payload.view?.private_metadata||'{}');
  const sending=meta.mode!=='manage';
  return {...meta,op:sending?'send':stateValue(payload,'op')?.selected_option?.value,note:stateValue(payload,'note')?.value||'',
    recipient:stateValue(payload,'recipient')?.value||'',subject:stateValue(payload,'subject')?.value||'',body:stateValue(payload,'body')?.value||'',
    confirmed:stateValue(payload,'confirm')?.selected_options?.some((o:any)=>o.value==='confirmed')===true,
    // DATE is converted in PostgreSQL with the Pacific timezone, including DST.
    owner_person:stateValue(payload,'owner')?.selected_option?.value||null,next_review_date:stateValue(payload,'date')?.selected_date||null};
}
export function isFollowupInteraction(payload:any):boolean {
  return payload.type==='view_submission' && payload.view?.callback_id==='mf:submit' || payload.type==='block_actions' && payload.actions?.some((a:any)=>typeof a.action_id==='string'&&a.action_id.startsWith('mf:'));
}
export async function handleFollowupInteraction(payload:any) {
  const staff=await resolveStaffBySlackId(payload.user?.id||'');
  if(!staff?.email || !await canReviewFollowups(staff.email)) {
    if(payload.type==='view_submission')return NextResponse.json({response_action:'errors',errors:{note:'This trial is reviewed by Penny and Craig.'}});
    if(payload.trigger_id)await slackView('views.open',{trigger_id:payload.trigger_id,view:resultView('This trial is reviewed by Penny and Craig.')});
    return new NextResponse(null,{status:200});
  }
  if(payload.type==='view_submission') {
    let inputData:ReturnType<typeof submissionInput>;
    try {inputData=submissionInput(payload);}catch{return NextResponse.json({response_action:'errors',errors:{note:'Reopen this review.'}});}
    if(inputData.op==='send') {
      if(!inputData.confirmed)return NextResponse.json({response_action:'errors',errors:{confirm:'Check the conversation and approve this message.'}});
      try{const {validateFollowupMessage}=await import('./estimate-followups');validateFollowupMessage(inputData);}catch(e){return NextResponse.json({response_action:'errors',errors:{body:(e as Error).message}});}
    } else if(!inputData.note.trim())return NextResponse.json({response_action:'errors',errors:{note:'Record the outcome for the team.'}});
    after(async()=>{
      let text='';
      try {await decideFollowup(staff.email!,inputData);text=inputData.op==='send'?'Follow-up sent. It is waiting for a reply; the work order remains open.':'Shared review updated.';}
      catch(e){text=`Could not complete the action: ${(e as Error).message}`;}
      try{await slackView('views.update',{view_id:payload.view.id,view:resultView(text)});}catch(e){console.error('[followup] modal result update failed',e);}
      await refreshFollowupSlack(inputData.id);
    });
    return NextResponse.json({response_action:'update',view:resultView('Processing your review. This view will show the result; do not resend while it is processing.')});
  }
  const action=payload.actions?.[0];if(!action||action.action_id==='mf:link')return new NextResponse(null,{status:200});
  if(!['mf:email','mf:sms_zoom','mf:manage'].includes(action.action_id) || !/^[\da-f-]{36}$/i.test(action.value||''))return new NextResponse(null,{status:200});
  const opened=await slackView('views.open',{trigger_id:payload.trigger_id,view:resultView('Loading current work-order context…')});
  after(async()=>{
    try {const q=await loadFollowupQueue();const c=q.candidates.find(c=>c.id===action.value);
      await slackView('views.update',{view_id:opened.view.id,view:c?followupModal(c,q.reviews.find(r=>r.work_order_id===c.id),action.action_id.slice(3),q):resultView('This item no longer needs follow-up. Open the shared queue for current work.')});
    }catch(e){await slackView('views.update',{view_id:opened.view.id,view:resultView(`Could not load review: ${(e as Error).message}`)});}
  });
  return new NextResponse(null,{status:200});
}
async function putMessage(email:string,userId:string,key:string,text:string,blocks:any[],workOrderId:string|null=null) {
  const db=getSupabaseAdmin();
  const {data:previous,error:readError}=await db.from('maintenance_followup_slack').select('*').eq('reviewer_email',email).eq('message_key',key).maybeSingle();
  if(readError)throw new Error(readError.message);
  if(previous) {
    if(previous.state!=='sent'||!previous.message_id)throw new Error(`Check unconfirmed Slack delivery for ${email} (${key}); automatic retry is disabled.`);
    const target=splitSlackMessageId(previous.message_id);if(!target)throw new Error('Invalid saved Slack message');
    const result=await updateSlackMessage({...target,text,blocks});
    if(result.status!=='sent')throw new Error(result.error||'Slack update failed');
    return previous.message_id as string;
  }
  const {data:claim,error}=await db.from('maintenance_followup_slack').insert({reviewer_email:email,message_key:key,work_order_id:workOrderId}).select('id').single();
  if(error){if(error.code==='23505')return null;throw new Error(error.message);}
  const result=await sendSlackMessage({channel:userId,text,blocks});
  const {error:saveError}=await db.from('maintenance_followup_slack').update({state:result.status==='sent'?'sent':'uncertain',message_id:result.message_id||null,error:result.error||null,updated_at:new Date().toISOString()}).eq('id',claim.id);
  if(saveError)throw new Error('Slack post attempted, but delivery record could not be saved. Check Slack before retrying.');
  if(result.status!=='sent')throw new Error(result.error||'Slack delivery uncertain');
  return result.message_id;
}
export async function refreshFollowupSlack(id:string) {
  try {
    const q=await loadFollowupQueue();const c=q.candidates.find(c=>c.id===id);if(!c)return;
    const {data,error}=await getSupabaseAdmin().from('maintenance_followup_slack').select('*').eq('work_order_id',id).eq('state','sent');if(error)throw error;
    for(const row of data||[]) {const target=splitSlackMessageId(row.message_id);if(!target)continue;
      const result=await updateSlackMessage({...target,text:`Maintenance follow-up — WO ${c.woNumber}`,blocks:followupCard(c,q.reviews.find(r=>r.work_order_id===id))});
      if(result.status!=='sent')console.error('[followup] Slack card refresh failed',result.error);
    }
  }catch(e){console.error('[followup] Slack refresh failed',e);}
}
export async function publishFollowupQueue(options:{preview?:boolean;now?:Date}={}) {
  const now=options.now||new Date();const q=await loadFollowupQueue();
  const due=q.candidates.filter(c=>c.eligible!==false && (c.newEpisode || followupDue(q.reviews.find(r=>r.work_order_id===c.id),now)));
  const selected=due.slice(0,7);
  if(options.preview)return {preview:true,total:due.length,reviewers:FOLLOWUP_REVIEWERS,cards:selected.map(c=>followupCard(c,q.reviews.find(r=>r.work_order_id===c.id))),messagingStatus:q.messagingStatus};
  if(!(await getAgentConfig('estimate_chaser','team_review'))?.enabled || await isGloballyKilled())throw new Error('Shared trial is not activated or messaging is paused');
  const results=[];
  for(const email of FOLLOWUP_REVIEWERS) {
    const staff=await resolveStaffByPersonOrEmail(email);
    if(!staff?.slack_user_id)throw new Error(`No active Slack identity for ${email}`);
    const links:string[]=[];
    for(const c of selected) {
      const saved=await putMessage(email,staff.slack_user_id,`wo:${c.id}`,`Maintenance follow-up — WO ${c.woNumber}`,followupCard(c,q.reviews.find(r=>r.work_order_id===c.id)),c.id);
      const target=saved?splitSlackMessageId(saved):null;
      if(target)links.push(`<${HOME}?followup=${c.id}#maintenance-followups|WO ${safe(c.woNumber||'—')}> · ${safe(c.property)} · ${safe(c.reason)}`);
    }
    // Reconcile existing cards too, so work resolved upstream stops displaying a send action.
    const {data:posted,error}=await getSupabaseAdmin().from('maintenance_followup_slack').select('work_order_id').eq('reviewer_email',email).eq('state','sent').not('work_order_id','is',null);
    if(error)throw error;
    for(const row of posted||[])if(!selected.some(c=>c.id===row.work_order_id))await refreshFollowupSlack(row.work_order_id);
    const text=`Maintenance follow-ups — ${due.length} need action. Showing ${selected.length}; ${Math.max(0,due.length-selected.length)} more in Company Issues.`;
    await putMessage(email,staff.slack_user_id,`summary:${todayPacific(now)}`,text,[section(text),...(links.length?[{type:'section',text:{type:'mrkdwn',text:links.join('\n').slice(0,2900)}}]:[]),{type:'actions',elements:[{type:'button',text:plain('Open full queue'),url:`${HOME}#maintenance-followups`,action_id:'mf:link'}]}]);
    results.push({email,items:selected.length});
  }
  for(const review of q.reviews.filter(r=>r.status==='help'))await fileFollowupHelp(review.work_order_id,review.updated_by,review.note);
  return {total:due.length,reviewers:results};
}
