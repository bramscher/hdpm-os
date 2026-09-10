import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canViewHabuDemo } from '@/lib/habu-demo-access';
import HabuOfficeDemo from './habu-demo';
import './habu-demo.css';

export const metadata = {
  title: 'HABU Office Routing Demo — HDPM',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function HabuDemoPage() {
  const session = await auth();
  if (!canViewHabuDemo(session?.user)) notFound();
  return <HabuOfficeDemo />;
}
