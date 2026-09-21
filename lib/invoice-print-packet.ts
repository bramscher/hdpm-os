import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { HdmsInvoice } from './invoices';
import { generateInvoicePdf } from './invoice-pdf-template';

export function validateInvoicePeriod(from: string, to: string) {
  const valid = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T12:00:00Z')) && new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
  if(!valid(from)||!valid(to)||from>to) throw new Error('Choose a valid start and end date');
  if((Date.parse(to)-Date.parse(from))/86400000>366) throw new Error('Choose a period of one year or less');
}
export function periodInvoices(invoices: HdmsInvoice[], from: string, to: string) {
  return invoices.filter(i=>i.status!=='void'&&i.doc_type!=='credit'&&(i.completed_date||i.created_at||'').slice(0,10)>=from&&(i.completed_date||i.created_at||'').slice(0,10)<=to)
    .sort((a,b)=>(a.completed_date||a.created_at).localeCompare(b.completed_date||b.created_at)||a.invoice_code.localeCompare(b.invoice_code));
}
/** Preserve saved issued PDFs. Drafts are rendered for review without issuing or storing them. */
export async function invoicePrintPacket(invoices: HdmsInvoice[], from: string, to: string, download: (path:string)=>Promise<Uint8Array>) {
  validateInvoicePeriod(from,to);
  const selected = periodInvoices(invoices,from,to);
  if(!selected.length) throw new Error('No invoices for this period');
  const packet = await PDFDocument.create();
  const font = await packet.embedFont(StandardFonts.Helvetica);
  const bold = await packet.embedFont(StandardFonts.HelveticaBold);
  const safe = (value: string) => value.replace(/[^\x20-\x7E]/g,'-');
  const entries: {invoice:HdmsInvoice,start:number,pages:number,recreated:boolean}[] = [];
  const coverCount = Math.ceil(selected.length/32);
  for(let i=0;i<coverCount;i++) packet.addPage([612,792]);
  for(let offset=0; offset<selected.length; offset+=4) {
    const prepared = await Promise.all(selected.slice(offset,offset+4).map(async invoice => {
      const saved=invoice.status!=='draft' && !!invoice.pdf_path;
      try { return {invoice,saved,bytes:saved ? await download(invoice.pdf_path!) : generateInvoicePdf(invoice)}; }
      catch { throw new Error(`Could not load ${invoice.invoice_code}. No incomplete packet was exported.`); }
    }));
    for(const {invoice,saved,bytes} of prepared) {
    let source: PDFDocument;
    try { source=await PDFDocument.load(bytes); } catch { throw new Error(`Invalid PDF for ${invoice.invoice_code}. No incomplete packet was exported.`); }
    const start=packet.getPageCount()+1;
    for(const page of await packet.copyPages(source,source.getPageIndices())) {
      packet.addPage(page);
      if(invoice.status==='draft') page.drawText('DRAFT - FOR INTERNAL REVIEW - NOT ISSUED',{x:40,y:10,size:9,font:bold,color:rgb(.7,.1,.1)});
      else if(!saved) page.drawText('RECREATED COPY - NO SAVED PDF AVAILABLE',{x:40,y:10,size:8,font,color:rgb(.4,.4,.4)});
    }
    entries.push({invoice,start,pages:source.getPageCount(),recreated:!saved&&invoice.status!=='draft'});
  }
  }
  for(let index=0;index<coverCount;index++) {
    const page=packet.getPage(index);
    page.drawText('High Desert - Invoice print packet',{x:40,y:746,size:20,font:bold});
    page.drawText(`${from} through ${to}`,{x:40,y:718,size:13,font});
    page.drawText(`${selected.length} invoices | ${selected.filter(i=>i.status==='draft').length} drafts | Sorted by completed date`,{x:40,y:695,size:10,font});
    page.drawText('Includes all invoice statuses except voids. Credit memos excluded.',{x:40,y:676,size:9,font});
    page.drawText('Drafts are review copies. Printing does not issue invoices or change their status.',{x:40,y:660,size:9,font});
    page.drawText('Invoice / completed date / property',{x:40,y:632,size:10,font:bold});
    page.drawText('Status / page',{x:445,y:632,size:10,font:bold});
    entries.slice(index*32,(index+1)*32).forEach((entry,row)=>{
      const y=610-row*16;
      const label=safe(`${entry.invoice.invoice_code} | ${(entry.invoice.completed_date||entry.invoice.created_at).slice(0,10)} | ${entry.invoice.property_name}`);
      let text=label;while(font.widthOfTextAtSize(text,8)>390)text=text.slice(0,-1);
      if(text!==label)text=text.slice(0,-3)+'...';
      page.drawText(text,{x:40,y,size:8,font});
      page.drawText(`${entry.invoice.status}${entry.recreated?'*':''} / ${entry.start}`,{x:445,y,size:8,font});
    });
    page.drawText('* Recreated copy: no saved issued PDF was available.',{x:40,y:70,size:8,font});
    page.drawText('Completed date determines the period; creation date is used when missing.',{x:40,y:55,size:8,font});
    page.drawText(`Contents ${index+1} of ${coverCount}`,{x:40,y:35,size:8,font});
  }
  packet.setTitle(`HDPM Invoices ${from} to ${to}`);
  return {bytes:await packet.save(),invoiceCount:selected.length,pageCount:packet.getPageCount()};
}
