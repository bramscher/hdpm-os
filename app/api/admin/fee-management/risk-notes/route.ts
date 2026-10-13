import { NextRequest } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { putRiskNote } from '@/lib/fee-management/risk-notes-api';

/** PUT — save the signed-in person's note on an at-risk owner (Matt and Penny). */
export async function PUT(request: NextRequest) {
  const guard = await requireSection('fee_management');
  if (!guard.ok) return guard.response;
  return putRiskNote(request, guard.email);
}
