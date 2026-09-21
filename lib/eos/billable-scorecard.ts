import { getSupabaseAdmin } from '@/lib/supabase';
import { weeklyBillableHours } from '@/lib/invoices';
import { invoiceWeekQuality } from './invoice-hour-quality';
import { logAudit } from '@/lib/audit';
import { isOnTrack, weekStartPacific, scorecardWeeks, SCORECARD_HISTORY_START } from './scorecard';
import type { ScorecardMetric } from './types';

/** Invoice-based history is recalculated because invoices can arrive after a week closes. */
export async function reconcileBillableScorecard(metrics: ScorecardMetric[], now: Date, dryRun = false) {
  const billable = metrics.filter(m => m.source === 'metrics_snapshot' && ['billable_hours.albertoHours','billable_hours.brodyHours'].includes(m.source_ref || ''));
  if (!billable.length) return 0;
  const db = getSupabaseAdmin();
  const invoices: Parameters<typeof weeklyBillableHours>[0] = [];
  for (let offset=0;;offset+=1000) {
    const {data,error} = await db.from('hdms_invoices').select('status,doc_type,line_items,completed_date,created_at,labor_amount').order('id').range(offset,offset+999);
    if(error) throw new Error(`Invoice hours could not be loaded: ${error.message}`);
    invoices.push(...(data || [])); if((data || []).length<1000) break;
  }
  const week = weekStartPacific(now);
  const {data:previous,error} = await db.from('scorecard_entry').select('metric_id,week_start,value,source,on_track').in('metric_id',billable.map(m=>m.id)).gte('week_start',SCORECARD_HISTORY_START).limit(10000);
  if(error) throw new Error(error.message);
  let updated=0;
  for(const start of scorecardWeeks(week)) {
    const totals = weeklyBillableHours(invoices,new Date(`${start}T19:00:00Z`));
    const quality = invoiceWeekQuality(invoices,start);
    for(const metric of billable) {
      const old = previous?.find(e=>e.metric_id===metric.id&&e.week_start===start);
      if(old?.source==='manual') continue;
      const tech = metric.source_ref==='billable_hours.albertoHours'?'Alberto':'Brody';
      const knownHours = totals.byTech[tech] || 0;
      const incomplete = quality.incomplete.has(tech);
      const value = incomplete && knownHours === 0 ? null : knownHours;
      const onTrack = incomplete ? null : isOnTrack(metric.goal_op,metric.goal_value,value);
      if(start !== week && !old && !quality.hasInvoices) continue;
      if(start !== week && old && old.value === value && old.on_track === onTrack) continue;
      if(!dryRun) {
        const {error:writeError} = await db.from('scorecard_entry').upsert({metric_id:metric.id,week_start:start,value,on_track:onTrack,source:'auto',entered_by:'system:invoice-reconciliation',updated_at:now.toISOString(),source_captured_at:now.toISOString()},{onConflict:'metric_id,week_start'});
        if(writeError) throw new Error(writeError.message);
        await logAudit('scorecard_entry',`${metric.id}:${start}`,'invoice_hours_reconciled','system:scorecard',{metric:metric.name,previous_value:old?.value??null,value,week_start:start,incomplete,known_hours:knownHours,basis:'Current hourly invoice lines, including drafts; voids and credits excluded'});
      }
      updated++;
    }
  }
  return updated;
}
