import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/require-role';
import { getSupabaseAdmin } from '@/lib/supabase';
import { effectiveCapabilities } from '@/lib/staff-capabilities';
import { hiddenFromRoster } from '@/lib/access/roster';
export async function GET() {
 const guard=await requireRole('admin');if(!guard.ok)return guard.response;
 const db=getSupabaseAdmin();
 // Verify current admin status; an old JWT is not permission to administer access.
 const admin=await db.from('staff').select('person').ilike('email',guard.email).eq('active',true).eq('access_role','admin').maybeSingle();
 if(admin.error||!admin.data)return NextResponse.json({error:'Active administrator required'},{status:403});
 const [staff,policies,audit]=await Promise.all([
  db.from('staff').select('person,email,active,access_role').eq('active',true).order('person'),
  db.from('staff_capability_policy').select('*'),
  db.from('staff_capability_audit').select('*').order('id',{ascending:false}).limit(100),
 ]);
 const error=staff.error||policies.error||audit.error;
 if(error)return NextResponse.json({error:'Could not load staff permissions'},{status:503});
 return NextResponse.json({staff:(staff.data||[]).filter(s=>!hiddenFromRoster(s.person)&&!hiddenFromRoster(s.email)).map(s=>{const p=policies.data?.find(p=>p.person===s.person);return {...s,overrides:p?.overrides||{},version:p?.version||0,capabilities:effectiveCapabilities(s.access_role,s.active,p?.overrides||{})};}),audit:audit.data||[]});
}
export async function PATCH(request:NextRequest) {
 const guard=await requireRole('admin');if(!guard.ok)return guard.response;
 try {
  const body=await request.json();
  const {data,error}=await getSupabaseAdmin().rpc('staff_capability_update',{actor:guard.email,request:body});
  if(error)return NextResponse.json({error:error.message},{status:error.message.includes('FORBIDDEN')?403:409});
  return NextResponse.json({policy:data});
 } catch {return NextResponse.json({error:'Invalid permission change'},{status:400});}
}
