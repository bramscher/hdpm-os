import type { AppFolioUnit } from './appfolio';
import { reconcileInspectionHistory, type AppFolioInspectionDetail, type AppFolioUnitInspection } from './inspection-history';
import { computeInspectionDueDate } from './inspection-candidates';
import { findHouseholdSource, householdAddressKey } from './inspection-route-households';
import { inspectionWorkflow, reconcileInspectionProperties, type QueueInspection, type QueueProperty } from './inspection-queue';
import { inspectionHorizon, inspectionToday, shiftInspectionDate } from './inspection-window';

export type InspectionReviewGroup = 'ready' | 'handled' | 'confirmation';
export interface InspectionEvidence {
  checked_at: string;
  units: { id: string; link: string | null; hidden: boolean; last_inspected: string | null; report_id: string | null;
    completed: string | null; open: { date: string | null; status: string }[] }[];
}
export interface ReviewedCandidate extends QueueProperty {
  id: string;
  review_group: InspectionReviewGroup;
  review_reason: string;
  review_item_type: 'candidate' | 'completion';
  appfolio_url: string | null;
  evidence_date: string | null;
  evidence_status: string | null;
}
const validDate = (date: string | null | undefined): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)
  && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
const latest = (...dates: (string | null | undefined)[]) => dates.filter(validDate).sort().at(-1) || null;
function monthsBefore(today: string, months: number) {
  const date = new Date(`${today}T12:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));
  return date.toISOString().slice(0,10);
}
export function buildInspectionEvidence(units: AppFolioUnit[], history: AppFolioInspectionDetail[], checkedAt: string, unitReport: AppFolioUnitInspection[] = []): InspectionEvidence {
  const today = inspectionToday(new Date(checkedAt));
  const byUnit = new Map<string, AppFolioInspectionDetail[]>();
  for (const record of history) {
    if (record.unit_id != null) byUnit.set(String(record.unit_id), [...(byUnit.get(String(record.unit_id)) || []), record]);
  }
  return {checked_at:checkedAt,units:reconcileInspectionHistory(units,history,today,unitReport).map(unit => {
    const reportId = /\/units\/(\d+)(?:[/?#]|$)/.exec(unit.link || '')?.[1] || null;
    const records = reportId ? byUnit.get(reportId) || [] : [];
    return {id:unit.id,link:unit.link || null,hidden:!!unit.hidden,last_inspected:unit.lastInspectedDate,report_id:reportId,
      completed:latest(...records.filter(r=>r.status==='DONE').map(r=>r.inspected_on||r.marked_done_on).filter(d=>validDate(d)&&d<=today)),
      open:records.filter(r=>['NEW','IN PROGRESS'].includes(r.status)).map(r=>({date:validDate(r.inspected_on)?r.inspected_on:null,status:r.status}))};
  })};
}

/** Trust the Unit Inspection report's last date without changing individual inspection statuses. */
export function reviewInspectionCandidates(rows: QueueInspection[], input: QueueProperty[], evidence: InspectionEvidence | null, today: string): ReviewedCandidate[] {
  const properties = reconcileInspectionProperties(rows,input,today);
  const units = new Map(evidence?.units.map(unit=>[unit.id,unit]) || []);
  const matches = new Map<string, QueueInspection[]>();
  const unresolved: QueueInspection[] = [];
  const cutoff = monthsBefore(today,6);
  for (const row of rows) {
    if (!['routine','biannual'].includes(row.inspection_type || '')) continue;
    const source = properties.find(p=>p.id===row.property_id) || (row.inspection_properties ? findHouseholdSource(row.inspection_properties,properties,row.resident_name) : null);
    if (source?.id) matches.set(source.id,[...(matches.get(source.id)||[]),row]);
    else if(row.status==='completed' && row.completed_at && inspectionToday(new Date(row.completed_at))>=cutoff && inspectionToday(new Date(row.completed_at))<=today) unresolved.push(row);
  }
  const result: ReviewedCandidate[] = properties.filter(p=>p.id&&p.candidate_status).map(property=>{
    const unit = property.appfolio_unit_id ? units.get(property.appfolio_unit_id) : undefined;
    const local = matches.get(property.id!) || [];
    const last = latest(property.last_inspection_date,unit?.last_inspected && unit.last_inspected<=today?unit.last_inspected:null,unit?.completed);
    // Recompute from both anchors, rather than trusting an old stored due date.
    const due = computeInspectionDueDate(property.move_in_date || null,last);
    const base: ReviewedCandidate = {...property,id:property.id!,last_inspection_date:last,next_due_date:due,
      review_group:'confirmation',review_reason:'',review_item_type:'candidate',appfolio_url:unit?.link || null,evidence_date:null,evidence_status:null};
    const set = (review_group: InspectionReviewGroup, review_reason: string, evidence_date: string | null = null, evidence_status: string | null = null): ReviewedCandidate => ({...base,review_group,review_reason,evidence_date,evidence_status});
    if(property.active===false || unit?.hidden) return set('handled','Inactive unit; excluded from scheduling.');
    if(property.routine_inspections_enabled===false) return set('handled','Routine inspections are excluded for this unit.');
    if(property.candidate_status==='dismissed') return set('handled','Dismissed from this inspection cycle.');
    if(property.local_skip_reason==='Vacant — no active tenant') return set('handled','No current tenant; scheduling deferred.');
    const appointments=local.map(row=>inspectionWorkflow(row,today));
    const future=appointments.find(row=>['scheduled','in_progress'].includes(row.status));
    if(future) return set('handled','Already on a local inspection route.',future.target_date,future.status);
    if(appointments.some(row=>row.status==='needs_review' && (!last || (row.target_date||'')>last))) return set('confirmation','A past route appointment has no confirmed completion.');
    if(property.candidate_status==='scheduled') return set('confirmation','This unit is marked scheduled but has no verifiable current appointment.');
    if(!evidence) return set('confirmation','AppFolio verification is unavailable. Refresh before scheduling.');
    if(!unit) return set('confirmation','Unit ID is missing from the current AppFolio feed. Check for a duplicate or inactive record.');
    if(!unit.report_id) return set('confirmation','The unit could not be linked to AppFolio inspection history.');
    if(property.last_inspection_date && (!validDate(property.last_inspection_date) || property.last_inspection_date>today)) return set('confirmation','The recorded last inspection date needs correction.');
    if(!validDate(property.move_in_date)) return set('confirmation','Confirm the current tenant’s move-in date before calculating the next due date.');
    if(property.move_in_date>today) return set('handled','The tenant’s move-in date is still in the future.');
    const syncDay=property.last_appfolio_sync_at?.slice(0,10);
    if(!syncDay || syncDay<shiftInspectionDate(today,-1)) return set('confirmation','Tenant and move-in records need a fresh AppFolio sync.');
    if(due && due>inspectionHorizon(today)) return set('handled','Next due date is outside the 21-day scheduling window.');
    const open=unit.open.filter(record=>!record.date || (record.date>=cutoff && record.date>=(property.move_in_date||'') && (!last || record.date>last)))
      .sort((a,b)=>(b.date||'9999').localeCompare(a.date||'9999'));
    if(open.length) {
      const visit=open[0];
      return set('confirmation',visit.date && visit.date>today
        ? 'AppFolio has a future inspection record. Confirm its appointment before creating another route.'
        : 'AppFolio has an open inspection record. Confirm whether the visit happened and update its status.',visit.date,visit.status);
    }
    const ambiguous=unresolved.some(row=>{
      const p=row.inspection_properties;
      if(!p) return false;
      const key=householdAddressKey(p);
      return (!!key && key===householdAddressKey(property)) || (!!p.name && p.name===property.name && p.city===property.city && p.zip===property.zip);
    });
    if(ambiguous) return set('confirmation','A recent local completion may belong to this unit; its unit match needs review.');
    if(!due) return set('confirmation','A valid move-in or completed inspection date is needed.');
    return set('ready','Due within 21 days or overdue, with current unit records and no conflicting recent inspection.');
  });
  // Keep unmatched completions visible without inventing a match or a new inspection.
  for(const row of unresolved) result.push({...row.inspection_properties,id:`completion:${row.id}`,candidate_status:null,
    last_inspection_date:inspectionToday(new Date(row.completed_at!)),move_in_date:null,next_due_date:null,
    review_group:'confirmation',review_reason:'Recorded local completion has no reliable AppFolio unit match. Review its property and unit before crediting a candidate.',
    review_item_type:'completion',appfolio_url:null,evidence_date:inspectionToday(new Date(row.completed_at!)),evidence_status:'completed'});
  return result;
}
export function inspectionReviewCounts(candidates: ReviewedCandidate[]) {
  return candidates.reduce((counts,candidate)=>{counts[candidate.review_group]++;return counts;},{ready:0,handled:0,confirmation:0});
}
