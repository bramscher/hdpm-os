import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { invoicePrintPacket, validateInvoicePeriod } from '@/lib/invoice-print-packet';
import type { HdmsInvoice } from '@/lib/invoices';
export const maxDuration=120;
export async function GET(request:NextRequest) {
  const guard=await requireRole('finance','maintenance','pm','manager');if(!guard.ok)return guard.response;
  const from=request.nextUrl.searchParams.get('from')||'',to=request.nextUrl.searchParams.get('to')||'';
  try {validateInvoicePeriod(from,to);}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
  try {
    const db=getSupabaseAdmin(),invoices:HdmsInvoice[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await db.from('hdms_invoices').select('*').neq('status','void').eq('doc_type','invoice').order('id').range(offset,offset+499);
      if(error)throw new Error(error.message);invoices.push(...(data||[]));if((data||[]).length<500)break;
    }
    const result=await invoicePrintPacket(invoices,from,to,async(path)=>{
      const {data,error}=await db.storage.from('hdms-invoices').download(path);
      if(error||!data)throw new Error('PDF download failed');return new Uint8Array(await data.arrayBuffer());
    });
    return new Response(Buffer.from(result.bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="HDPM_Invoices_${from}_to_${to}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Invoice-Count':String(result.invoiceCount)}});
  }catch(e){return NextResponse.json({error:(e as Error).message},{status:422});}
}
