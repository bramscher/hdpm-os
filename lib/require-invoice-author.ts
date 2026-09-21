import { NextResponse } from 'next/server';
import { requireCompanySession } from './require-role';
import { canCreateInvoices } from './invoice-permissions';

export async function requireInvoiceAuthor() {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  if (canCreateInvoices(guard.role, guard.email)) return guard;
  return {ok: false as const, response: NextResponse.json({error: 'Insufficient invoice permissions'}, {status: 403})};
}
