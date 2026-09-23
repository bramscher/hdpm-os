import {describe,it,expect} from 'vitest';
import {unreconciledInvoices,availableReconciliationPayments,reconciliationPaymentChoice} from '../reconciliation-options';
import {aggregate,chargedSplit} from '../invoice-analysis';
const full={id:'august',amount:13825.89,invoice_total:13825.89};
const open={id:'september',amount:21000,invoice_total:1000};
describe('Reconciliation choices',()=>{
  it('excludes the fully used August payment shown in the screenshot',()=>{
    expect(availableReconciliationPayments([full,open])).toEqual([open]);
    expect(reconciliationPaymentChoice([full])).toEqual({mode:'new',selectedPaymentId:''});
  });
  it('does not silently choose another existing payment',()=>{
    expect(reconciliationPaymentChoice([full,open])).toEqual({mode:'existing',selectedPaymentId:''});
    expect(reconciliationPaymentChoice([full,open],{mode:'existing',selectedPaymentId:full.id})).toEqual({mode:'existing',selectedPaymentId:''});
  });
  it('restores a still-open payment and retains explicit new-payment mode',()=>{
    expect(reconciliationPaymentChoice([open],{mode:'existing',selectedPaymentId:open.id})).toEqual({mode:'existing',selectedPaymentId:open.id});
    expect(reconciliationPaymentChoice([open],{mode:'new',selectedPaymentId:''})).toEqual({mode:'new',selectedPaymentId:''});
  });
  it('handles cents and excludes over-applied payments',()=>{
    expect(availableReconciliationPayments([{amount:0.3,invoice_total:0.1+0.2},{amount:100,invoice_total:101},{amount:100,invoice_total:99.99},{amount:null,invoice_total:0}])).toEqual([{amount:100,invoice_total:99.99},{amount:null,invoice_total:0}]);
  });
  it('excludes already-paid and void invoices while retaining unapplied credits',()=>{
    const rows=[{id:'paid',payment_id:'august',status:'generated'},{id:'void',payment_id:null,status:'void'},{id:'new',payment_id:null,status:'generated'},{id:'credit',payment_id:null,status:'generated'}];
    expect(unreconciledInvoices(rows).map(i=>i.id)).toEqual(['new','credit']);
  });
  it('does not double count linked invoices in selection totals',()=>{
    const invoice=(id:string,total:number,payment_id:string|null)=>({id,status:'generated',payment_id,total_amount:total,labor_amount:total,materials_amount:0,tax_amount:0,doc_type:total<0?'credit':'invoice',line_items:[]});
    const selected=unreconciledInvoices([invoice('paid',13825.89,'august'),invoice('new',20506.18,null),invoice('credit',-100,null)]);
    expect(chargedSplit(aggregate(selected as any)).total).toBe(20406.18);
  });
});
