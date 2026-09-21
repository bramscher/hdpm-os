/** Run with production environment loaded. Preview by default; --apply writes audited corrections. */
import { getSupabaseAdmin } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { reconcileBillableScorecard } from '../../lib/eos/billable-scorecard';
import { historicalScorecardValues } from '../../lib/eos/scorecard-history';
import { SCORECARD_HISTORY_START, isOnTrack, weekStartPacific } from '../../lib/eos/scorecard';
import type { ScorecardMetric } from '../../lib/eos/types';
async function main(){
 const db=getSupabaseAdmin(),now=new Date(),apply=process.argv.includes('--apply');
 const {data:metrics,error}=await db.from('scorecard_metric').select('*').eq('org_id','hdpm').eq('active',true);if(error)throw error;
 const snapshots:{source:string;name:string;value:Record<string,unknown>;captured_at:string}[]=[];
 for(const [table,key,source] of [['metrics_snapshot','metric','metrics_snapshot'],['kpi_snapshots','kpi_name','kpi_snapshot']]) {
   const names=[...new Set((metrics||[]).filter(m=>m.source===source&&m.source_ref&&!m.source_ref.startsWith('billable_hours.')).map(m=>m.source_ref.split('.')[0]))];
   if(!names.length)continue;
   for(let offset=0;;offset+=1000){const {data,error}=await db.from(table).select('*').in(key,names).gte('captured_at',SCORECARD_HISTORY_START+'T07:00:00Z').order('captured_at').order('id').range(offset,offset+999);if(error)throw error;
   snapshots.push(...(data||[]).map(r=>({source,name:r[key],value:r.value,captured_at:r.captured_at})));if((data||[]).length<1000)break;}
 }
 let restored=0;
 for(const cell of historicalScorecardValues(metrics as ScorecardMetric[],snapshots,weekStartPacific(now))){
  const {data:existing,error}=await db.from('scorecard_entry').select('metric_id').eq('metric_id',cell.metric.id).eq('week_start',cell.week_start).maybeSingle();if(error)throw error;if(existing)continue;
  restored++;
  if(apply){const {error}=await db.from('scorecard_entry').upsert({metric_id:cell.metric.id,week_start:cell.week_start,value:cell.value,on_track:isOnTrack(cell.metric.goal_op,cell.metric.goal_value,cell.value),source:'auto',entered_by:'system:historical-snapshot',updated_at:now.toISOString(),source_captured_at:cell.captured_at},{onConflict:'metric_id,week_start',ignoreDuplicates:true});if(error)throw error;
  await logAudit('scorecard_entry',`${cell.metric.id}:${cell.week_start}`,'history_restored','system:scorecard',{value:cell.value,source_captured_at:cell.captured_at,basis:'Original snapshot from the same reporting week'});}
 }
 const hours=await reconcileBillableScorecard(metrics as ScorecardMetric[],now,!apply);
 console.log(JSON.stringify({applied:apply,historicalCellsRestored:restored,invoiceCellsReconciled:hours}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
