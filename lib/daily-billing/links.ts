import type {HdmsInvoice} from '@/lib/invoices';
export interface LinkableWorkOrder {id:string;wo_number:string|null}
/** Live invoices (not void, not credit memos) linked to a work order by id, or by a work-order number that matches exactly one work order. */
export function linkInvoices<W extends LinkableWorkOrder>(invoices:HdmsInvoice[],workOrders:W[]){
 const refs=new Map<string,W[]>();
 for(const wo of workOrders){if(wo.wo_number){const key=wo.wo_number.trim();refs.set(key,[...(refs.get(key)||[]),wo]);}}
 const live=invoices.filter(i=>i.status!=='void'&&i.doc_type!=='credit');
 const invoiceWo=new Map<string,string>();const ambiguous=new Set<string>();
 for(const invoice of live){if(invoice.work_order_id){invoiceWo.set(invoice.id,invoice.work_order_id);continue;}const matches=refs.get(invoice.wo_reference?.trim()||'')||[];if(matches.length===1)invoiceWo.set(invoice.id,matches[0].id);else if(matches.length>1)ambiguous.add(invoice.id);}
 return {refs,live,invoiceWo,ambiguous};
}
/** PostgREST `or` filter for High Desert Maintenance (in-house) work orders. */
export const inHouseVendorFilter=(internalVendorIds:string[])=>`vendor_id.in.(${internalVendorIds.join(',')}),vendor_name.ilike.%high desert maintenance%`;
