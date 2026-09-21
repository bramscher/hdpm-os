// Read-only production checks. Supply a local env file exported through Vercel.
import {config} from 'dotenv';
import {createClient} from '@supabase/supabase-js';
config({path:process.argv[2]||'.env.local'});
const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Supabase URL and service role are required; no credentials are printed.');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const reviewers=['penny@highdesertpm.com','craig@highdesertpm.com'];
const [staff,review,slack,configRow,clock]=await Promise.all([
 db.from('staff').select('email,person,active,slack_user_id').in('email',reviewers),
 db.from('estimate_followup_review').select('work_order_id,episode_key').limit(1),
 db.from('maintenance_followup_slack').select('id').limit(1),
 db.from('agent_config').select('agent,action_type,enabled,autonomy_level,ceiling_level').eq('agent','estimate_chaser'),
 db.rpc('followup_next_review',{anchor:new Date().toISOString()}),
]);
const checks={
 reviewers:reviewers.map(email=>{const row=staff.data?.find(r=>r.email?.toLowerCase()===email);return {email,active:row?.active===true,slackLinked:!!row?.slack_user_id};}),
 schema:{reviews:!review.error,slack:!slack.error,businessDayClock:!clock.error},
 configuration:configRow.data||[],
 email:{configured:!!process.env.RESEND_API_KEY,from:process.env.AGENT_EMAIL_FROM||process.env.MAINT_DIGEST_FROM||'HDPM Agents <maintenance@highdesertpm.com>'},
 sms:{sender:process.env.ZOOM_SMS_SENDER_EMAIL||'cheryl@highdesertpm.com',numberConfigured:!!process.env.ZOOM_SMS_SENDER_NUMBER,preview:process.env.AGENT_ZOOM_SMS_DRYRUN==='1'},
 preview:process.env.AGENT_GRAPH_DRYRUN==='1'||process.env.AGENT_PILOT_SHADOW==='1',
 errors:[staff,review,slack,configRow,clock].flatMap(r=>r.error?[r.error.message]:[]),
};
if(process.env.SLACK_BOT_TOKEN){
 const response=await fetch('https://slack.com/api/auth.test',{method:'POST',headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(10000)});
 const result=await response.json();checks.slack={authenticated:!!result.ok,error:result.error||null};
}else checks.slack={authenticated:false,error:'SLACK_BOT_TOKEN missing'};
console.log(JSON.stringify(checks,null,2));
if(checks.errors.length||checks.reviewers.some(r=>!r.active||!r.slackLinked)||!checks.slack.authenticated)process.exitCode=1;
