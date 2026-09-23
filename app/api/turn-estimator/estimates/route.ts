import { requireEstimateAuthor } from '@/lib/require-estimate-author';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createEstimate } from '@/lib/turn-estimator/estimates';

/** POST /api/turn-estimator/estimates — create a draft estimate. maintenance/pm/admin. */
export async function POST(request: NextRequest) {
  const guard = await requireEstimateAuthor();
  if (!guard.ok) return guard.response;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  try {
    const estimate = await createEstimate(body as never, guard.email);
    return NextResponse.json({ estimate });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

export async function GET(request:NextRequest){
 const g=await requireEstimateAuthor(true);if(!g.ok)return g.response;
 const id=request.nextUrl.searchParams.get('work_order_id');if(!id)return NextResponse.json({error:'Work order required'},{status:400});
 const {data,error}=await getSupabaseAdmin().from('estimate').select('id,status,current_version_id').eq('work_order_id',id).order('created_at',{ascending:false});
 return NextResponse.json(error?{error:error.message}:{estimates:data},{status:error?400:200});
}
