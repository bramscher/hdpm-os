import {beforeEach,describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({tables:[] as string[],data:{} as Record<string,any[]>}));
vi.mock('@/lib/dashboard-config',()=>({getDashboardConfig:async()=>({internalVendorIds:['internal']})}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:(table:string)=>{
 mock.tables.push(table);let rows=mock.data[table]||[];const q:any={};q.select=q.order=q.or=q.gte=q.lte=()=>q;q.eq=(key:string,value:unknown)=>{rows=rows.filter(r=>r[key]===value);return q};q.in=(key:string,value:unknown[])=>{rows=rows.filter(r=>value.includes(r[key]));return q};q.limit=async()=>({data:[],error:null});q.range=async()=>({data:rows,error:null});return q;
}})}));
import {loadDailyBilling} from '../server';
const actor=(role:string,office:boolean,person='Alberto')=>({person,name:person,email:person.toLowerCase()+'@highdesertpm.com',access_role:role,office,admin:role==='admin',allowed:true});
beforeEach(()=>{mock.tables=[];mock.data={staff:[{person:'Alberto',name:'Alberto',active:true},{person:'Brody',name:'Brody',active:true}],maintenance_work_record:[{id:'a',task_id:null,technician:'Alberto',work_date:'2026-09-14',minutes:60,status:'submitted',note:'Work'},{id:'b',task_id:null,technician:'Brody',work_date:'2026-09-14',minutes:120,status:'submitted',note:'Other work'}],timekeeping_employee:[{id:'employee',staff_person:'Alberto'}],timekeeping_sheet:[{id:'s',employee_id:'employee',days:[{date:'2026-09-14',shifts:[{start:'2026-09-14T15:00:00Z',end:'2026-09-14T23:00:00Z',source:'manual',breaks:[]}],leave:[],miles:0}]}]};});
describe('daily review payroll privacy',()=>{
 it('never reads or returns payroll for office coordinators',async()=>{
 const data=await loadDailyBilling(actor('staff',true,'Penny'),'2026-09-14','2026-09-20','Alberto');expect(mock.tables).not.toContain('timekeeping_sheet');expect(mock.tables).not.toContain('timekeeping_employee');expect(data.days[0]).not.toHaveProperty('workedHours');expect(data.days[0]).not.toHaveProperty('unexplainedHours');
 });
 it('forces technicians to their own activity even when another name is requested',async()=>{
 const data=await loadDailyBilling(actor('field',false),'2026-09-14','2026-09-20','Brody');expect(data.records.map(r=>r.technician)).toEqual(['Alberto']);expect(data.technician).toBe('Alberto');expect(mock.tables).not.toContain('timekeeping_sheet');expect(mock.tables).not.toContain('hdms_invoices');expect(data.days[0]).not.toHaveProperty('issuedLabor');expect(data.invoiceOptions).toEqual([]);
 });
 it('returns only an admin summary, with no raw shifts or leave details',async()=>{
 const data=await loadDailyBilling(actor('admin',true,'Craig'),'2026-09-14','2026-09-20','Alberto');expect(mock.tables).toContain('timekeeping_sheet');expect(data.days[0]).toMatchObject({workedHours:8,scheduledHours:0,unexplainedHours:7});expect(JSON.stringify(data)).not.toContain('2026-09-14T15:00:00Z');expect(JSON.stringify(data)).not.toContain('payroll_id');
 });
});
