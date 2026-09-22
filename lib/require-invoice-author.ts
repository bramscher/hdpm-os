import { loadStaffCapabilities } from './staff-capabilities-server';
import { NextResponse } from 'next/server';
import { requireCompanySession } from './require-role';
import { canCreateInvoices } from './invoice-permissions';

export async function requireInvoiceAuthor() {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  const capabilities = await loadStaffCapabilities(guard.email);
  if (canCreateInvoices(guard.role, guard.email, capabilities)) return {...guard, capabilities};
  return {ok: false as const, response: NextResponse.json({error: 'Insufficient invoice permissions'}, {status: 403})};
}
