import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { GrowthDashboard } from './dashboard';

export const metadata = { title: 'Owner growth · HDPM OS' };

export default async function GrowthPage() {
  const guard = await requireSection('growth');
  if (!guard.ok) redirect('/');
  return <GrowthDashboard />;
}
