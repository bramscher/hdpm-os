import Link from 'next/link';
import { requireRole } from '@/lib/require-role';
import { redirect } from 'next/navigation';
import { ManagementFeeIndex } from '@/components/dashboard/ManagementFeeIndex';
export default async function AdminPage(){const guard=await requireRole('admin');if(!guard.ok)redirect('/');return <main className="mx-auto max-w-6xl p-8"><h1 className="mb-6 text-3xl font-semibold">Administration</h1><Link href="/admin/staff-permissions" className="block rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Staff permissions</h2><p className="mt-2 text-sm">Manage invoice, estimate, and template access. Review the change history.</p></Link><h2 className="mb-3 mt-10 text-xl font-semibold">KPI index</h2><ManagementFeeIndex /></main>;}
