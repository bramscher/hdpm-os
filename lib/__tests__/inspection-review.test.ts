import { computeInspectionDueDate } from '../inspection-candidates';
import { describe, expect, it } from 'vitest';
import { buildInspectionEvidence, inspectionReviewCounts, reviewInspectionCandidates, type InspectionEvidence } from '../inspection-review';
import type { QueueInspection, QueueProperty } from '../inspection-queue';
import type { AppFolioUnit } from '../appfolio';
const today='2026-09-28';
const checked='2026-09-28T19:00:00Z';
const property: QueueProperty={id:'p',appfolio_unit_id:'uuid',candidate_status:'eligible',move_in_date:'2024-01-01',last_inspection_date:'2026-03-01',next_due_date:'2026-09-01',last_appfolio_sync_at:checked,address_1:'100 Main St',city:'Bend',zip:'97701'};
const unit: AppFolioUnit={id:'uuid',link:'https://highdesertpm.appfolio.com/properties/1/units/123',hidden:false,lastInspectedDate:'2026-03-01',propertyId:'property',name:'Home',address1:'100 Main St',address2:null,city:'Bend',state:'OR',zip:'97701',status:'Occupied'};
const evidence = (open: {date:string|null;status:string}[] = []): InspectionEvidence => ({checked_at:checked,units:[{id:'uuid',link:unit.link!,hidden:false,last_inspected:'2026-03-01',report_id:'123',completed:null,open}]});
const row=(overrides:Partial<QueueInspection>={}):QueueInspection=>({id:'i',property_id:'p',inspection_type:'routine',status:'queued',due_date:'2026-09-01',target_date:null,assigned_to:null,resident_name:null,inspection_properties:property,...overrides});
const review=(p:QueueProperty=property,e:InspectionEvidence|null=evidence(),rows:QueueInspection[]=[])=>reviewInspectionCandidates(rows,[p],e,today);

describe('inspection review groups',()=>{
  it.each(['NEW','IN PROGRESS'])('trusts the Unit Inspection report date despite %s status',status=>{
    const e=buildInspectionEvidence([unit],[{unit_id:123,status,inspected_on:'2026-08-01',marked_done_on:null}],checked,
      [{unit_id:123,last_inspection_date:'2026-08-01'}]);
    expect(review(property,e)[0]).toMatchObject({review_group:'handled',last_inspection_date:'2026-08-01',next_due_date:'2027-02-01'});
    expect(e.units[0].completed).toBeNull();
    expect(e.units[0].open[0].status).toBe(status);
    expect(review({...property,move_in_date:'2026-09-01'},e)[0].next_due_date).toBe('2027-03-01');
    expect(review(property,e,[row({status:'completed',completed_at:checked})])[0].last_inspection_date).toBe(today);
  });
  it('makes a reported visit due within 21 days ready while retaining newer conflicting records',()=>{
    const history=[{unit_id:123,status:'IN PROGRESS',inspected_on:'2026-04-15',marked_done_on:null}];
    const report=[{unit_id:123,last_inspection_date:'2026-04-15'}];
    expect(review(property,buildInspectionEvidence([unit],history,checked,report))[0]).toMatchObject({review_group:'ready',next_due_date:'2026-10-15'});
    expect(review(property,buildInspectionEvidence([unit],[...history,{...history[0],inspected_on:'2026-09-01'}],checked,report))[0].review_group).toBe('confirmation');
  });
  it('adds six calendar months consistently across time zones and month ends',()=>{
    for(const [anchor,due] of [['2026-03-01','2026-09-01'],['2026-07-01','2027-01-01'],['2026-08-31','2027-02-28']]) {
      expect(computeInspectionDueDate(anchor,null)).toBe(due);
    }
  });
  it('makes a current, unconflicted overdue unit ready',()=>{
    expect(review()[0]).toMatchObject({review_group:'ready',next_due_date:'2026-09-01'});
  });
  it('recomputes from the later move-in or completed inspection, ignoring stale due dates',()=>{
    expect(review({...property,move_in_date:'2026-07-01'})[0]).toMatchObject({review_group:'handled',next_due_date:'2027-01-01'});
    const e=evidence();e.units[0].completed='2026-09-01';
    expect(review(property,e)[0]).toMatchObject({review_group:'handled',next_due_date:'2027-03-01'});
  });
  it('includes day 21 and holds day 22 outside scheduling',()=>{
    expect(review({...property,last_inspection_date:'2026-04-19'})[0]).toMatchObject({review_group:'ready',next_due_date:'2026-10-19'});
    expect(review({...property,last_inspection_date:'2026-04-20'})[0].review_group).toBe('handled');
  });
  it.each(['NEW','IN PROGRESS'])('holds recent %s records for confirmation without treating them as completed',status=>{
    expect(review(property,evidence([{status,date:'2026-08-01'}]))[0]).toMatchObject({review_group:'confirmation',last_inspection_date:'2026-03-01',evidence_status:status,evidence_date:'2026-08-01'});
  });
  it('does not let open records from before move-in or a later confirmed visit block a new cycle',()=>{
    expect(review(property,evidence([{status:'NEW',date:'2023-08-01'}]))[0].review_group).toBe('ready');
    expect(review(property,evidence([{status:'IN PROGRESS',date:'2026-02-01'}]))[0].review_group).toBe('ready');
  });
  it('holds future appointments and undated open records for review',()=>{
    for(const date of ['2026-10-01',null]) expect(review(property,evidence([{status:'NEW',date}]))[0].review_group).toBe('confirmation');
  });
  it('requires current identity, history bridge, tenant sync, and move-in date',()=>{
    expect(review(property,{checked_at:checked,units:[]})[0].review_group).toBe('confirmation');
    const e=evidence();e.units[0].report_id=null;
    expect(review(property,e)[0].review_group).toBe('confirmation');
    expect(review({...property,last_appfolio_sync_at:'2026-08-01'})[0].review_group).toBe('confirmation');
    expect(review({...property,move_in_date:null})[0].review_group).toBe('confirmation');
  });
  it('never marks unverified candidates ready during an AppFolio outage',()=>{
    expect(review(property,null)[0].review_group).toBe('confirmation');
  });
  it('keeps exclusions and existing appointments out of scheduling',()=>{
    for(const p of [{...property,active:false},{...property,routine_inspections_enabled:false},{...property,candidate_status:'dismissed'},{...property,local_skip_reason:'Vacant — no active tenant'}]) expect(review(p)[0].review_group).toBe('handled');
    expect(review(property,evidence(),[row({route_stops:[{status:'pending',route_plans:{id:'r',status:'optimized',route_date:'2026-09-29'}}]})])[0].review_group).toBe('handled');
  });
  it('credits uniquely matched local completions without rewriting records',()=>{
    const completed=row({status:'completed',completed_at:checked});
    expect(review(property,evidence(),[completed])[0]).toMatchObject({review_group:'handled',next_due_date:'2027-03-28'});
    expect(completed.due_date).toBe('2026-09-01');
  });
  it('keeps unmatched completions visible and holds potentially affected units',()=>{
    const completed=row({property_id:'old',inspection_properties:{...property,id:'old',appfolio_unit_id:null},status:'completed',completed_at:checked});
    const candidates=reviewInspectionCandidates([completed],[property,{...property,id:'neighbor',appfolio_unit_id:'uuid2'}],{...evidence(),units:[...evidence().units,{...evidence().units[0],id:'uuid2'}]},today);
    expect(candidates).toHaveLength(3);
    expect(candidates.every(c=>c.review_group==='confirmation')).toBe(true);
    expect(candidates[2]).toMatchObject({id:'completion:i',review_item_type:'completion',evidence_status:'completed'});
    expect(inspectionReviewCounts(candidates)).toEqual({ready:0,handled:0,confirmation:3});
  });
  it('builds evidence only from matching unit IDs and genuine completed records',()=>{
    const result=buildInspectionEvidence([unit],[
      {unit_id:123,status:'DONE',inspected_on:'2026-08-01',marked_done_on:'2026-09-01'},
      {unit_id:123,status:'IN PROGRESS',inspected_on:'2026-09-01',marked_done_on:null},
      {unit_id:123,status:'DONE',inspected_on:'2027-01-01',marked_done_on:null},
      {unit_id:999,status:'DONE',inspected_on:today,marked_done_on:null},
    ],checked);
    expect(result.units[0]).toMatchObject({completed:'2026-08-01',open:[{date:'2026-09-01',status:'IN PROGRESS'}]});
  });
});
