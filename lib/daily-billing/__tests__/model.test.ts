import {describe,it,expect} from 'vitest';
import {buildDailyBilling,type Input} from '../model';
import {recordedLaborHours,invoiceServiceDate} from '@/lib/invoice-labor';
import {dailyBillingAccess} from '../access';
const invoice=(extra={})=>({id:'i',invoice_code:'INV-1',status:'generated',doc_type:'invoice',completed_date:'2026-09-14',created_at:'2026-09-15T00:00:00Z',property_name:'Property',wo_reference:'123',work_order_id:null,total_amount:190,labor_amount:190,line_items:[{type:'labor',qty:2,amount:190,technician:'Alberto'}],...extra}) as any;
const wo=(extra={})=>({id:'w',wo_number:'123',property_name:'Property',description:'Repair',completed_date:'2026-09-14',assigned_tech:'Alberto',status:'done',appfolio_status:'Work Completed',canceled_date:null,...extra}) as any;
const input=(extra:Partial<Input>={}):Input=>({from:'2026-09-14',to:'2026-09-20',today:'2026-09-21',technician:'Alberto',invoices:[],workOrders:[],records:[],bills:[],decisions:[],tasks:[],jobs:[],allocations:[],billsFresh:true,...extra});
describe('daily billing review',()=>{
 it('separates drafts and issued labor, excludes credit hours, and preserves signed credit dollars',()=>{
  const data=buildDailyBilling(input({invoices:[invoice(),invoice({id:'draft',status:'draft'}),invoice({id:'credit',doc_type:'credit',line_items:[{type:'labor',qty:1,amount:-95,technician:'Alberto'}]}),invoice({id:'void',status:'void'})]}));expect(data.days[0]).toMatchObject({issuedHours:2,draftHours:2,issuedLabor:95,draftLabor:190});
 });
 it('matches only unique work order references without updating records',()=>{const data=buildDailyBilling(input({workOrders:[wo()],invoices:[invoice()]}));expect(data.issues.some(i=>i.kind==='no_invoice')).toBe(false);expect(data.issues.some(i=>i.kind==='data_quality')).toBe(false);
 const ambiguous=buildDailyBilling(input({workOrders:[wo(),wo({id:'w2'})],invoices:[invoice()]}));expect(ambiguous.issues.some(i=>i.kind==='data_quality'&&i.detail.includes('multiple'))).toBe(true);expect(ambiguous.issues.filter(i=>i.kind==='no_invoice')).toHaveLength(2);});
 it('a recent issued invoice needs verified AppFolio posting',()=>{
  const matched={id:'b',hdms_invoice_id:'i',reference:'INV-1',total_amount:190,synced_at:'2026-09-21'};
  expect(buildDailyBilling(input({invoices:[invoice()],bills:[matched]})).issues.some(i=>i.kind==='posting')).toBe(false);
  expect(buildDailyBilling(input({invoices:[invoice()],bills:[matched],billsFresh:false})).issues.find(i=>i.kind==='posting')?.title).toContain('unavailable');
 });
 it('does not count canceled work, but recognizes exact direct AppFolio work-order billing',()=>{
  expect(buildDailyBilling(input({workOrders:[wo({canceled_date:'2026-09-15'})]})).issues).toEqual([]);
  expect(buildDailyBilling(input({workOrders:[wo()],bills:[{id:'b',hdms_invoice_id:null,reference:'123',total_amount:190,synced_at:'2026-09-21'}]})).issues).toEqual([]);
 });
 it('keeps actual work on its work date and does not treat an invoice as coverage for every visit',()=>{
  const record={id:'r',task_id:null,work_order_id:'w',technician:'Alberto',work_date:'2026-09-15',minutes:60,activity_kind:'job',progress:'done',status:'reviewed',billability:'billable',note:'Work',materials:'',review_note:'Reviewed',review_owner:'Brody',version:2};
  const result=buildDailyBilling(input({invoices:[invoice()],workOrders:[wo()],records:[record]}));expect(result.days[0].issuedHours).toBe(2);expect(result.days[0].projectHours).toBe(0);expect(result.days[1].projectHours).toBe(1);expect(result.issues.some(i=>i.recordId==='r'&&i.kind==='ready')).toBe(true);
 });
 it('returns deferred and previously resolved exceptions to the queue on their review date',()=>{
  const result=buildDailyBilling(input({workOrders:[wo()],decisions:[{issue_key:'wo:w:no_invoice',disposition:'resolved',owner:'Penny',review_on:'2026-09-21',note:'Recheck posting',updated_at:'2026-09-20'}]}));expect(result.counts.active).toBe(1);expect(result.issues[0].overdue).toBe(true);
 });
 it('does not infer hours from flat fees or dollar-only labor',()=>{expect(recordedLaborHours({qty:3,pricing_method:'flat'})).toBe(0);expect(recordedLaborHours({type:'labor'})).toBe(0);expect(recordedLaborHours({qty:3,workspace_task_id:'task'})).toBe(0);});
 it('uses Pacific dates only for creation-date fallback',()=>{expect(invoiceServiceDate({created_at:'2026-09-15T01:00:00Z'})).toBe('2026-09-14');expect(invoiceServiceDate({completed_date:'2026-09-15',created_at:'2026-09-15T01:00:00Z'})).toBe('2026-09-15');});
 it('does not grant coordinators admin payroll access',()=>{expect(dailyBillingAccess('staff','penny@highdesertpm.com')).toMatchObject({office:true,admin:false});expect(dailyBillingAccess('field','alberto@highdesertpm.com')).toMatchObject({office:false,admin:false});});
});
