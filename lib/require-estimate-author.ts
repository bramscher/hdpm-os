import { NextResponse } from 'next/server';
import { requireCompanySession } from './require-role';
import { loadStaffCapabilities } from './staff-capabilities-server';
import type { Capability } from './staff-capabilities';
export async function requireEstimateAuthor(readOnly = false, capability: Capability = 'estimate.draft') {
 const guard = await requireCompanySession();
 if (!guard.ok) return guard;
 try {
  const capabilities=await loadStaffCapabilities(guard.email);
  if (capabilities[capability] || (readOnly && guard.role==='finance')) return {...guard,capabilities};
  return {ok:false as const,response:NextResponse.json({error:'Insufficient estimate permissions'},{status:403})};
 } catch { return {ok:false as const,response:NextResponse.json({error:'Staff permissions are temporarily unavailable'},{status:503})}; }
}
