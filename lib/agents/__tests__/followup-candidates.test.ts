import {describe,expect,it} from 'vitest';
import {schedulingFollowups} from '../estimate-followups';
const now=new Date('2026-09-21T15:00:00Z');
const wo={id:'wo',status:'open',appfolio_status:'Assigned',scheduled_start:null,appfolio_created_at:'2026-09-01T15:00:00Z'};
const snapshot=(rows:any[])=>({now,openWorkOrders:rows,statusSince:new Map()} as any);
describe('work-order scheduling candidates',()=>{
 it('finds assigned work without a date using the existing threshold',()=>{expect(schedulingFollowups(snapshot([wo]))).toEqual([wo]);});
 it('excludes closed, already scheduled, and recently assigned work',()=>{expect(schedulingFollowups(snapshot([{...wo,status:'closed'},{...wo,scheduled_start:'2026-09-22'},{...wo,appfolio_last_updated_at:'2026-09-18T15:00:00Z'}]))).toEqual([]);});
 it('includes new unassigned work after one business day',()=>{expect(schedulingFollowups(snapshot([{...wo,appfolio_status:'New',appfolio_last_updated_at:'2026-09-17T15:00:00Z'}]))).toHaveLength(1);});
 it('uses the recorded status-entry clock rather than old creation date',()=>{const s=snapshot([wo]);s.statusSince.set('wo','2026-09-18T15:00:00Z');expect(schedulingFollowups(s)).toEqual([]);});
});
