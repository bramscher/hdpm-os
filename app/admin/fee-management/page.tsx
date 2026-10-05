import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { FeeManagement } from './fee-management';

export const metadata = { title: 'Fee Management · HDPM OS' };

export default async function FeeManagementPage() {
  const guard = await requireSection('fee_management');
  if (!guard.ok) redirect('/');
  return <FeeManagement />;
}
