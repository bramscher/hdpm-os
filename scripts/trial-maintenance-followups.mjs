// Default is a read-only preview. --publish sends INTERNAL Slack cards only.
import {config} from 'dotenv';
config({path:process.argv.find(a=>a.startsWith('--env='))?.slice(6)||'.env.local'});
const publish=process.argv.includes('--publish');
if(!process.env.CRON_SECRET)throw new Error('CRON_SECRET is required');
const response=await fetch(`https://hdpmchat.highdesertpm.com/api/maintenance/cron/followups?${publish?'manual=1':'preview=1'}`,{headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(120000)});
const result=await response.json();
if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
console.log(JSON.stringify(result,null,2));
