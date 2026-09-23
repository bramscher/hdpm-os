import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { validReconciliationDraft } from '@/lib/reconciliation-draft';

// A reserved key in the existing draft store; old per-period selections are retained.
const KEY = 'active-reconciliation';
async function owner() {
  const email = (await auth())?.user?.email;
  return email?.endsWith('@highdesertpm.com') ? email.toLowerCase() : null;
}
function rows(email: string) {
  return getSupabaseAdmin().from('hdms_reconcile_selection').select('filters,updated_at')
    .eq('created_by', email).eq('period_from', KEY).eq('period_to', '');
}
export async function GET() {
  const email = await owner();
  if (!email) return NextResponse.json({error:'Unauthorized'}, {status:401});
  const {data,error} = await rows(email).maybeSingle();
  if (error) return NextResponse.json({error:'Could not load your saved reconciliation.'}, {status:500});
  return NextResponse.json({draft:data?.filters?.draft ?? null, revision:data?.filters?.revision ?? null, savedAt:data?.updated_at ?? null});
}
export async function PUT(request: NextRequest) {
  const email = await owner();
  if (!email) return NextResponse.json({error:'Unauthorized'}, {status:401});
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({error:'Invalid draft'}, {status:400}); }
  if (!validReconciliationDraft(body.draft) || !(body.revision === null || typeof body.revision === 'string')) return NextResponse.json({error:'Invalid draft'}, {status:400});
  const revision = crypto.randomUUID();
  const values = {invoice_ids:body.draft.list.invoiceIds, filters:{draft:body.draft,revision}, updated_at:new Date().toISOString()};
  const db = getSupabaseAdmin();
  const result = body.revision === null
    ? await db.from('hdms_reconcile_selection').insert({...values,created_by:email,period_from:KEY,period_to:''}).select('updated_at').maybeSingle()
    : await db.from('hdms_reconcile_selection').update(values).eq('created_by',email).eq('period_from',KEY).eq('period_to','').eq('filters->>revision',body.revision).select('updated_at').maybeSingle();
  if (result.error || !result.data) return NextResponse.json({error:result.error && result.error.code !== '23505' ? 'Could not save reconciliation. Retry before leaving.' : 'This reconciliation changed in another tab. Reload before editing again.'}, {status:result.error && result.error.code !== '23505' ? 500 : 409});
  return NextResponse.json({revision,savedAt:result.data.updated_at});
}
export async function DELETE(request: NextRequest) {
  const email = await owner();
  if (!email) return NextResponse.json({error:'Unauthorized'}, {status:401});
  const revision = request.nextUrl.searchParams.get('revision');
  if (!revision) return NextResponse.json({error:'Missing revision'}, {status:400});
  const {data,error} = await getSupabaseAdmin().from('hdms_reconcile_selection').delete().eq('created_by',email).eq('period_from',KEY).eq('period_to','').eq('filters->>revision',revision).select('id');
  if (error || !data?.length) return NextResponse.json({error:'Could not delete this draft. Reload and try again.'}, {status:error ? 500 : 409});
  return NextResponse.json({ok:true});
}
