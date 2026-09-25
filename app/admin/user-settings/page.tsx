import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import UserSettings from './user-settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User settings · HDPM OS' };

export default async function Page() {
  const guard = await requireRole('admin');
  if (!guard.ok) redirect('/');
  return <UserSettings />;
}
