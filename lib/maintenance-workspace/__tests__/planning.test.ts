import { describe, expect, it } from 'vitest';
import { dayPlan, plannedValues, remainingScope, workCapacity, type AvailabilityProfile } from '../planning';
import type { Task, Visit, Workspace } from '../model';

const task:Task={id:'t',job_id:'j',description:'Turn scope',item_code:'TEST',pricing_method:'flat',amount:1050,service_value:950,quantity:1,approved:true};
const visit=(id:string,date:string,technicians=['Alberto'],minutes=60):Visit=>({id,job_id:'j',technicians,work_date:date,start_minute:540,planned_minutes:minutes,status:'planned',note:'',version:1,source:'local_plan'});
const profile:AvailabilityProfile={person:'Alberto',enabled:true,starts_on:'2026-01-01',ends_on:null,schedule:{weekdays:[1,2,3,4,5],start:'08:00',end:'17:00',paidBreak:20,unpaidBreak:60},exceptions:[]};
function workspace(visits:Visit[]=[]):Workspace{return {office:true,person:'Craig',jobs:[{id:'j',work_order_id:'wo',property_name:'Fixture',property_address:'',unit_name:null,title:'Turn',status:'active',progress_billing:false,approval_note:''}],tasks:[task],visits,records:[],allocations:[],invoices:[],targets:[],staff:[{person:'Alberto',name:'Alberto'},{person:'Brody',name:'Brody'}],availability:[profile]};}

describe('maintenance revenue forecasts',()=>{
 it('counts a flat-fee job once across multiple days and technicians, preserving cents',()=>{
  const data=workspace([visit('a','2026-09-21',['Alberto','Brody'],60),visit('b','2026-09-22',['Alberto'],60)]);
  const values=plannedValues(data,'2026-09-18');
  expect(values.reduce((sum,v)=>sum+Math.round(v.revenue*100),0)).toBe(105000);
  expect(values.reduce((sum,v)=>sum+Math.round(v.service*100),0)).toBe(95000);
  expect(values.filter(v=>v.day==='2026-09-21').reduce((sum,v)=>sum+v.revenue,0)).toBe(700);
  expect(values.find(v=>v.day==='2026-09-22')?.service).toBe(316.68);
 });
 it('does not reallocate the entire fee into a filtered week',()=>{
  const values=plannedValues(workspace([visit('a','2026-09-21'),visit('b','2026-10-01')]),'2026-09-18');
  expect(values.filter(v=>v.day<'2026-10-01').reduce((sum,v)=>sum+v.revenue,0)).toBe(525);
 });
 it('excludes cancelled, completed and overdue visits from upcoming forecasts',()=>{
  const data=workspace([visit('old','2026-09-17'),{...visit('cancel','2026-09-21'),status:'cancelled'},{...visit('done','2026-09-22'),status:'complete'},visit('next','2026-09-23')]);
  expect(plannedValues(data,'2026-09-18')).toMatchObject([{visitId:'next',revenue:1050}]);
 });
 it('removes drafted and reported-complete tasks from future value',()=>{
  const data=workspace([visit('a','2026-09-21')]);
  data.allocations=[{task_id:'t',invoice_id:'i',amount:1050,service_value:950,benchmark:95}];
  expect(plannedValues(data,'2026-09-18')[0].revenue).toBe(0);
  data.allocations=[];data.records=[{id:'r',task_id:'t',visit_id:null,technician:'Alberto',work_date:'2026-09-18',minutes:60,progress:'done',status:'submitted',note:'',materials:'',review_note:'',review_owner:null,version:1}];
  expect(remainingScope(data,'j')).toHaveLength(0);
  data.records[0].status='returned';expect(remainingScope(data,'j')).toHaveLength(1);
 });
 it('labels an unpriced booking without inventing revenue from hours',()=>{
  const data=workspace([visit('a','2026-09-21')]);data.tasks=[];
  expect(plannedValues(data,'2026-09-18')[0]).toMatchObject({revenue:0,service:0,priced:false});
 });
 it('does not multiply charges when a crew member is repeated',()=>{
  const values=plannedValues(workspace([visit('a','2026-09-21',['Alberto','Alberto'])]),'2026-09-18');
  expect(values).toHaveLength(1);expect(values[0].revenue).toBe(1050);
 });
});

describe('workweek availability',()=>{
 it('subtracts all breaks and recorded unavailable minutes without changing payroll',()=>{
  expect(workCapacity(profile,'2026-09-21')).toBe(460);
  expect(workCapacity({...profile,exceptions:[{date:'2026-09-21',off:false,unavailableMinutes:120}]},'2026-09-21')).toBe(340);
 });
 it('distinguishes unknown workweeks from off days and inactive dates',()=>{
  expect(workCapacity(undefined,'2026-09-21')).toBeNull();
  expect(workCapacity({...profile,schedule:null},'2026-09-21')).toBeNull();
  expect(workCapacity(profile,'2026-09-20')).toBe(0);
  expect(workCapacity({...profile,enabled:false},'2026-09-21')).toBe(0);
  expect(workCapacity({...profile,exceptions:[{date:'2026-09-21',off:true,unavailableMinutes:0}]},'2026-09-21')).toBe(0);
 });
 it('places overnight capacity on both calendar dates',()=>{
  const overnight={...profile,schedule:{weekdays:[1],start:'22:00',end:'06:00',paidBreak:0,unpaidBreak:0}};
  expect(workCapacity(overnight,'2026-09-21')).toBe(120);
  expect(workCapacity(overnight,'2026-09-22')).toBe(360);
 });
 it('uses all job bookings, excludes the visit being edited and flags overload',()=>{
  const data=workspace([visit('a','2026-09-21',['Alberto'],480),{...visit('b','2026-09-21'),job_id:'another',start_minute:1000}]);
  expect(dayPlan(data,'Alberto','2026-09-21')).toMatchObject({booked:540,capacity:460,available:0,overbooked:80,conflict:true});
  expect(dayPlan(data,'Alberto','2026-09-21','a')).toMatchObject({booked:60,available:400,overbooked:0,conflict:false});
 });
 it('does not use the $95 equivalent-hours target as capacity or revenue',()=>{
  const data=workspace([visit('a','2026-09-21')]);data.targets=[{technician:'Alberto',effective_from:'2026-01-01',benchmark:95,min_hours:6,max_hours:8}];
  expect(dayPlan(data,'Alberto','2026-09-21').capacity).toBe(460);
  expect(plannedValues(data,'2026-09-18')[0].revenue).toBe(1050);
 });
});
