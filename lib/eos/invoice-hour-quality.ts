import { normalizeTechnician, type HdmsInvoice } from '@/lib/invoices';
import { weeksBefore } from './scorecard';
import { invoiceServiceDate } from '@/lib/invoice-labor';
type Invoice = Pick<HdmsInvoice,'status'|'line_items'|'completed_date'|'created_at'> & {doc_type?:string;labor_amount?:number};
/** Missing attribution or quantities prevent treating a technician total as complete. */
export function invoiceWeekQuality(invoices:Invoice[],start:string) {
 const end=weeksBefore(start,-1),incomplete=new Set<string>();let hasInvoices=false;
 for(const invoice of invoices){
  const date=invoiceServiceDate(invoice)||'';
  if(invoice.status==='void'||invoice.doc_type==='credit'||date<start||date>=end)continue;
  hasInvoices=true;
  const labor=(invoice.line_items||[]).filter(li=>(li.type||'labor')==='labor'&&!li.workspace_task_id&&(!li.pricing_method||li.pricing_method==='hourly'));
  if(!invoice.line_items?.length&&Number(invoice.labor_amount)>0){incomplete.add('Alberto');incomplete.add('Brody');}
  for(const line of labor){const tech=normalizeTechnician(line.technician)||line.technician?.trim();
   if(!tech){incomplete.add('Alberto');incomplete.add('Brody');}
   else if(!line.qty||line.qty<=0)incomplete.add(tech);
  }
 }
 return {hasInvoices,incomplete};
}
