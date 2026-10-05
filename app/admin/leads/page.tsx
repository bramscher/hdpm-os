import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import { WEBSITE_URL } from '@/lib/hdpm-web-admin';
import { Leads } from './leads';

export const metadata = { title: 'Leads · HDPM OS' };

export default async function LeadsPage() {
  const guard = await requireRole('admin');
  if (!guard.ok) redirect('/');
  return <Leads websiteUrl={WEBSITE_URL} />;
}
