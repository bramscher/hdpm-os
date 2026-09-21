import {describe,it,expect,vi} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {invoicePrintPacket,periodInvoices,validateInvoicePeriod} from '../invoice-print-packet';
const row=(props={})=>({id:'1',invoice_code:'HDMS-INV-1',status:'generated',doc_type:'invoice',completed_date:'2026-06-15',created_at:'2026-06-18T00:00:00Z',property_name:'Test property',pdf_path:'saved.pdf',...props}) as any;
describe('payroll invoice packets',()=>{
 it('includes period boundaries, falls back to created date, excludes voids and credits',()=>{
 const input=[row(),row({id:'2',completed_date:'2026-06-16'}),row({id:'3',completed_date:'2026-06-01',status:'draft'}),row({status:'void'}),row({doc_type:'credit'}),row({id:'4',completed_date:null,created_at:'2026-06-02T12:00:00Z'})];expect(periodInvoices(input,'2026-06-01','2026-06-15').map(x=>x.id)).toEqual(['3','4','1']);
 });
 it('rejects invalid dates and reversed ranges',()=>{for(const [a,b] of [['2026-02-30','2026-03-01'],['bad','2026-06-01'],['2026-06-16','2026-06-01']])expect(()=>validateInvoicePeriod(a,b)).toThrow();});
 it('preserves all pages of saved issued invoices and adds contents',async()=>{
 const original=await PDFDocument.create();original.addPage([400,500]);original.addPage([600,700]);const bytes=await original.save();const download=vi.fn(async()=>bytes);
 const result=await invoicePrintPacket([row()],'2026-06-01','2026-06-15',download);const packet=await PDFDocument.load(result.bytes);expect(packet.getPageCount()).toBe(3);expect(packet.getPage(1).getSize()).toEqual({width:400,height:500});expect(result.invoiceCount).toBe(1);expect(download).toHaveBeenCalledWith('saved.pdf');
 });
 it('fails the entire packet on missing saved PDFs',async()=>{await expect(invoicePrintPacket([row()],'2026-06-01','2026-06-15',async()=>{throw new Error('missing')})).rejects.toThrow('No incomplete packet');});
 it('refuses an empty export',async()=>{await expect(invoicePrintPacket([],'2026-06-01','2026-06-15',vi.fn())).rejects.toThrow('No invoices');});
});
