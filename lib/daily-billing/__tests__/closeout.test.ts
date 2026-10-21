import {describe,it,expect} from 'vitest';
import {buildCloseout,type CloseoutInput} from '../closeout';
const shift=(date:string,start='15:00',end='23:30',lunch=30)=>({id:date,start:`${date}T${start}:00.000Z`,end:`${date}T${end}:00.000Z`,source:'manual' as const,breaks:[{id:'l',start:null,end:null,paid:false,minutes:lunch}]});
const day=(date:string,extra={})=>({date,off:false,shifts:[shift(date)],leave:[],miles:0,note:'',...extra}) as any;
const wo=(id:string,n:string)=>({id,wo_number:n,property_name:`Prop ${n}`,description:'Repair'});
const rec=(id:string,date:string,minutes:number,extra={})=>({id,task_id:null,work_order_id:'w1',technician:'Alberto',work_date:date,minutes,activity_kind:'job',progress:'done',note:'n',materials:'',status:'reviewed',billability:'billable',review_note:'',review_owner:null,version:1,...extra}) as any;
const inv=(id:string,date:string,lines:any[],extra={})=>({id,invoice_code:`HDMS-INV-${id}`,status:'generated',doc_type:'invoice',completed_date:date,created_at:`${date}T20:00:00Z`,property_name:'Prop',wo_reference:'100-1',work_order_id:'w1',line_items:lines,...extra}) as any;
const input=(extra:Partial<CloseoutInput>={}):CloseoutInput=>({technician:'Alberto',from:'2026-10-01',to:'2026-10-02',timecard:[day('2026-10-01')],records:[],invoices:[],workOrders:[wo('w1','100-1'),wo('w2','200-1')],routeStops:[],...extra});

describe('billing closeout',()=>{
 it('a day with nothing logged is all unexplained; the timecard is worked time less unpaid breaks',()=>{
  const c=buildCloseout(input());
  expect(c.days[0]).toMatchObject({workedMinutes:480,loggedMinutes:0,gapMinutes:480,status:'open'});
  expect(c.days[1].status).toBe('no_time');
  expect(c.summary.unexplainedMinutes).toBe(480);
 });
 it('closes a day once logged time is within 15 minutes of the timecard',()=>{
  const c=buildCloseout(input({records:[rec('r1','2026-10-01',300),rec('r2','2026-10-01',170,{work_order_id:null,activity_kind:'parts',billability:'nonbillable'})]}));
  expect(c.days[0]).toMatchObject({loggedMinutes:470,status:'balanced'});
  expect(c.summary).toMatchObject({jobMinutes:300,overhead:{parts:170},unexplainedMinutes:10});
 });
 it('drafts do not count toward the day',()=>{
  expect(buildCloseout(input({records:[rec('r1','2026-10-01',480,{status:'draft'})]})).days[0].status).toBe('open');
 });
 it('coverage is per work order across invoices whatever date they carry (Oct 9 lesson)',()=>{
  const records=[rec('r1','2026-10-01',180)];
  const later=inv('1','2026-10-14',[{type:'labor',qty:3,amount:285,technician:'Alberto'}]);
  const c=buildCloseout(input({records,invoices:[later]}));
  expect(c.coverage[0]).toMatchObject({woId:'w1',state:'covered',invoicedMinutes:180});
  expect(c.days[0].entries[0].coverage).toBe('covered');
  expect(c.summary.notInvoicedMinutes).toBe(0);
 });
 it('partly invoiced and not invoiced job time feed the to-invoice list; flat price covers the visit',()=>{
  const records=[rec('r1','2026-10-01',240),rec('r2','2026-10-01',120,{work_order_id:'w2'})];
  const partial=buildCloseout(input({records,invoices:[inv('1','2026-10-01',[{type:'labor',qty:1,amount:95,technician:'Alberto'}])]}));
  expect(partial.coverage.map(c=>[c.woId,c.state])).toEqual([['w2','not_invoiced'],['w1','partial']]);
  expect(partial.summary.notInvoicedMinutes).toBe(180+120);
  const flat=buildCloseout(input({records,invoices:[inv('1','2026-10-01',[{type:'labor',pricing_method:'flat',amount:129,technician:'Alberto'}])]}));
  expect(flat.coverage.find(c=>c.woId==='w1')?.state).toBe('covered');
 });
 it("only counts the selected tech's labor lines, and ignores void and credit invoices",()=>{
  const records=[rec('r1','2026-10-01',60)];
  const invoices=[inv('1','2026-10-01',[{type:'labor',qty:1,amount:95,technician:'Brody'}]),inv('2','2026-10-01',[{type:'labor',qty:1,amount:95,technician:'Alberto'}],{status:'void'}),inv('3','2026-10-01',[{type:'labor',qty:1,amount:-95,technician:'Alberto'}],{doc_type:'credit'})];
  expect(buildCloseout(input({records,invoices})).coverage[0].state).toBe('not_invoiced');
 });
 it('suggests route stops and invoiced work orders not yet logged',()=>{
  const c=buildCloseout(input({routeStops:[{date:'2026-10-01',work_order_id:'w2'}],invoices:[inv('1','2026-10-01',[{type:'labor',qty:2,amount:190,technician:'Alberto'}])]}));
  expect(c.days[0].suggestions).toEqual([{woId:'w1',label:'Prop 100-1 · 100-1',minutes:120,source:'invoice'},{woId:'w2',label:'Prop 200-1 · 200-1',minutes:0,source:'route'}]);
  const logged=buildCloseout(input({records:[rec('r1','2026-10-01',60)],routeStops:[{date:'2026-10-01',work_order_id:'w1'}]}));
  expect(logged.days[0].suggestions).toEqual([]);
 });
 it('shows leave and clock times; a vacation day has no worked time to explain',()=>{
  const c=buildCloseout(input({timecard:[day('2026-10-01'),day('2026-10-02',{shifts:[],leave:[{kind:'vacation',minutes:480}]})]}));
  expect(c.days[0].span).toBe('8:00 AM–4:30 PM');
  expect(c.days[1]).toMatchObject({leaveMinutes:480,workedMinutes:0,status:'no_time'});
 });
});
