import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import { FeeManagement } from './fee-management';

export const metadata = { title: 'Fee Management · HDPM OS' };

export default async function FeeManagementPage() {
  const guard = await requireRole('admin');
  if (!guard.ok) redirect('/');
  return <FeeManagement />;
}
