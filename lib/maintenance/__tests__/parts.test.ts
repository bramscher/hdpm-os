import {describe,expect,it} from 'vitest';
import {partsChaseDue,firstDayPast,needsHelp,countContacts,validatePartsOrderInput,buildSupplierDraft} from '../parts';
// Noon Pacific on the given day.
const at=(d:string)=>new Date(`${d}T19:00:00Z`);
const order=(o:Record<string,unknown>={})=>({status:'ordered' as const,ordered_at:'2026-09-21',expected_at:null as string|null,delivered_at:null as string|null,...o});

describe('firstDayPast',()=>{
 it('skips weekends',()=>{expect(firstDayPast('2026-10-02',1)).toBe('2026-10-06');expect(firstDayPast('2026-09-21',5)).toBe('2026-09-29');});
});
describe('partsChaseDue',()=>{
 it('expected date: due once more than one business day past it (Fri → Tue, not Mon)',()=>{
  const o=order({expected_at:'2026-10-02'});
  expect(partsChaseDue(o,{},at('2026-10-05')).due).toBe(false);
  const tue=partsChaseDue(o,{},at('2026-10-06'));expect(tue.due).toBe(true);expect(tue.dueAt).toBe('2026-10-06');expect(tue.reason).toMatch(/Expected Oct 2/);
 });
 it('no expected date: due after five business days',()=>{
  expect(partsChaseDue(order(),{},at('2026-09-28')).due).toBe(false);
  expect(partsChaseDue(order(),{},at('2026-09-29')).due).toBe(true);
 });
 it('delivered with no service date: due after two business days at the property',()=>{
  const o=order({status:'delivered',delivered_at:'2026-10-01T18:00:00Z'});
  // Delivered Thu Oct 1: Thu and Fri pass by Monday, so the third business day (Tue) is due.
  expect(partsChaseDue(o,{},at('2026-10-05')).due).toBe(false);
  expect(partsChaseDue(o,{},at('2026-10-06')).due).toBe(true);
  expect(partsChaseDue(o,{scheduled_start:'2026-10-07T16:00:00Z'},at('2026-10-20')).due).toBe(false);
 });
 it('issue is always due; installed and cancelled never are',()=>{
  expect(partsChaseDue(order({status:'issue'}),{},at('2026-09-22')).due).toBe(true);
  expect(partsChaseDue(order({status:'installed'}),{},at('2026-12-01')).due).toBe(false);
  expect(partsChaseDue(order({status:'cancelled'}),{},at('2026-12-01'))).toMatchObject({due:false,dueAt:null});
 });
 it('uses the Pacific date late in the evening',()=>{
  // 2026-10-06 03:00Z is still Oct 5 in Bend.
  expect(partsChaseDue(order({expected_at:'2026-10-02'}),{},new Date('2026-10-06T03:00:00Z')).due).toBe(false);
 });
});
describe('help and contacts',()=>{
 it('counts calls, emails, and texts but not notes or status changes',()=>{expect(countContacts([{kind:'call'},{kind:'email'},{kind:'text'},{kind:'note'},{kind:'status'}])).toBe(3);});
 it('needs help on an issue or three contacts',()=>{expect(needsHelp({status:'issue'},0)).toBe(true);expect(needsHelp({status:'ordered'},2)).toBe(false);expect(needsHelp({status:'shipped'},3)).toBe(true);});
});
describe('validatePartsOrderInput',()=>{
 const now=at('2026-09-30');
 const base={supplier_id:'6f1c2a3b-1111-4222-8333-944455556666',item:'Dishwasher',ordered_at:'2026-09-29'};
 it('accepts a minimal order and trims fields',()=>{expect(validatePartsOrderInput({...base,order_number:' 123 '},now)).toMatchObject({order_number:'123',expected_at:null,supplier_name:null});});
 it('accepts a new supplier by name',()=>{expect(validatePartsOrderInput({...base,supplier_id:'other',supplier_name:'Bend Appliance'},now).supplier_name).toBe('Bend Appliance');});
 it('rejects missing supplier, item, future order dates, early expected dates, and bad links',()=>{
  expect(()=>validatePartsOrderInput({...base,supplier_id:''},now)).toThrow(/supplier/);
  expect(()=>validatePartsOrderInput({...base,item:'  '},now)).toThrow(/part/);
  expect(()=>validatePartsOrderInput({...base,ordered_at:'2026-10-01'},now)).toThrow(/future/);
  expect(()=>validatePartsOrderInput({...base,expected_at:'2026-09-28'},now)).toThrow(/before/);
  expect(()=>validatePartsOrderInput({...base,tracking_url:'javascript:alert(1)'},now)).toThrow(/http/);
 });
});
describe('buildSupplierDraft',()=>{
 it('quotes the order, PO, and expected date without dollar amounts',()=>{
  const d=buildSupplierDraft({item:'Dishwasher',order_number:'884',po_number:'WO-1201',ordered_at:'2026-09-15',expected_at:'2026-09-25',status:'ordered'},{name:'Lowe\'s (Bend Pro desk)',account_number:null},{woNumber:'1201',property:'12 Elm St',unit:'B'});
  expect(d.subject).toContain('#884');expect(d.emailBody).toContain('PO WO-1201');expect(d.emailBody).toContain('Sep 25');expect(d.emailBody).toContain('Unit B');
  expect(`${d.emailBody}${d.smsBody}`).not.toMatch(/\$/);
 });
});
