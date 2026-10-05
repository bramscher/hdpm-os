import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/require-role';
import { WEBSITE_URL } from '@/lib/hdpm-web-admin';
import { Hiring } from './hiring';

export const metadata = { title: 'Hiring · HDPM OS' };

export default async function HiringPage() {
  const guard = await requireRole('admin');
  if (!guard.ok) redirect('/');
  return <Hiring websiteUrl={WEBSITE_URL} />;
}
