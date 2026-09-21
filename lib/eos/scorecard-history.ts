import { weekStartPacific } from './scorecard';
import type { ScorecardMetric } from './types';

/** Use only original snapshots from that reporting week; never carry newer data backward. */
export function historicalScorecardValues(metrics: ScorecardMetric[], snapshots: {source:string;name:string;value:Record<string,unknown>;captured_at:string}[], currentWeek:string) {
  const cells = new Map<string,{metric:ScorecardMetric;week_start:string;value:number;captured_at:string}>();
  for(const snapshot of [...snapshots].sort((a,b)=>a.captured_at.localeCompare(b.captured_at))) {
    const week = weekStartPacific(new Date(snapshot.captured_at));
    if(week>=currentWeek)continue;
    for(const metric of metrics) {
      if(metric.source !== snapshot.source || !metric.source_ref?.startsWith(snapshot.name+'.') || metric.source_ref.startsWith('billable_hours.'))continue;
      let value:unknown=snapshot.value;
      for(const key of metric.source_ref.slice(snapshot.name.length+1).split('.')) value=value&&typeof value==='object'?(value as Record<string,unknown>)[key]:undefined;
      // The latest snapshot wins, including null/unavailable values.
      const key=`${metric.id}:${week}`;
      if(typeof value==='number'&&Number.isFinite(value))cells.set(key,{metric,week_start:week,value,captured_at:snapshot.captured_at});
      else cells.delete(key);
    }
  }
  return [...cells.values()];
}
