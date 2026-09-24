import { describe, expect, it } from 'vitest';
import { appointmentTime, monthGridDays, schedulingQueue } from '../scheduling';
import type { Workspace, Job, Task, Visit } from '../model';
import type { EstimateQueueItem } from '../../turn-estimator/estimate-queue';
const job:Job={id:'job',work_order_id:'wo',property_name:'Maple',property_address:'123 Maple',unit_name:'2',title:'Turn',status:'active',progress_billing:false,approval_note:''};
const estimate:EstimateQueueItem={id:'estimate',property:'Maple',unit:'2',workOrder:'123',workOrderId:'wo',stage:'approved',status:'approved',total:100,updatedAt:'2026-09-24',href:'/estimate',taskCount:0,undraftedTasks:0};
const data=():Workspace=>({office:true,person:'Craig',jobs:[job],tasks:[],visits:[],records:[],allocations:[],invoices:[],staff:[],targets:[]});
describe('scheduling calendar',()=>{
 it('uses complete Monday-first weeks across month and year boundaries',()=>{
  for(const date of ['2026-09-24','2026-12-31','2027-01-01','2028-02-15']){
   const days=monthGridDays(date);expect(days.length%7).toBe(0);expect(new Date(days[0]+'T12:00:00Z').getUTCDay()).toBe(1);expect(new Date(days.at(-1)+'T12:00:00Z').getUTCDay()).toBe(0);expect(new Set(days).size).toBe(days.length);
  }
  expect(monthGridDays('2028-02-15')).toContain('2028-02-29');
 });
 it('labels noon, midnight and appointments ending next day',()=>{
  expect(appointmentTime(720)).toBe('12:00 PM');expect(appointmentTime(0)).toBe('12:00 AM');expect(appointmentTime(1470)).toBe('12:30 AM next day');
 });
});
describe('unified scheduling queue',()=>{
 it('groups a job with all its estimates without dropping any approved estimate',()=>{
  const rows=schedulingQueue(data(),[estimate,{...estimate,id:'second'}],'','2026-09-24');expect(rows).toHaveLength(1);expect(rows[0].job?.id).toBe('job');expect(rows[0].estimates).toHaveLength(2);
 });
 it('excludes jobs with future visits, but includes cancelled or overdue visits',()=>{
  const d=data();const visit:Visit={id:'visit',job_id:'job',technicians:['Alberto'],work_date:'2026-09-25',start_minute:510,planned_minutes:60,status:'planned',note:'',version:0,source:'local_plan'};d.visits=[visit];expect(schedulingQueue(d,[estimate],'','2026-09-24')).toEqual([]);
  d.visits=[{...visit,status:'cancelled'}];expect(schedulingQueue(d,[estimate],'','2026-09-24')).toHaveLength(1);
  d.visits=[{...visit,work_date:'2026-09-23'}];expect(schedulingQueue(d,[estimate],'','2026-09-24')).toHaveLength(1);
 });
 it('does not requeue completed or already-billed scope from an old approved estimate',()=>{
  const d=data();d.tasks=[{id:'task',job_id:'job',description:'Scope',item_code:null,pricing_method:'flat',amount:100,service_value:100,quantity:1,approved:true} as Task];d.allocations=[{task_id:'task',invoice_id:'invoice',amount:100,service_value:100,benchmark:95}];expect(schedulingQueue(d,[estimate],'','2026-09-24')).toEqual([]);
 });
 it('keeps unlinked estimates distinct and applies the same property search to all rows',()=>{
  const d=data();d.jobs=[];const rows=[{...estimate,workOrderId:null},{...estimate,id:'other',property:'Pine',workOrderId:null}];expect(schedulingQueue(d,rows)).toHaveLength(2);expect(schedulingQueue(d,rows,'pine')).toHaveLength(1);
 });
 it('keeps unpriced work orders visible and excludes unapproved estimates and closed jobs',()=>{
  expect(schedulingQueue(data(),[{...estimate,stage:'approval_pending'}])).toHaveLength(1);
  const d=data();d.jobs=[{...job,status:'closed'}];expect(schedulingQueue(d,[estimate])).toEqual([]);
 });
});
