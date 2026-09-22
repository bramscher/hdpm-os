import { NextResponse } from 'next/server';
import { requireCompanySession } from './require-role';
import { canAuthorEstimates } from './turn-estimator/access';
export async function requireEstimateAuthor(readOnly = false) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  if (canAuthorEstimates(guard.role, guard.email) || (readOnly && guard.role === 'finance')) return guard;
  return {ok:false as const,response:NextResponse.json({error:'Insufficient estimate permissions'},{status:403})};
}
