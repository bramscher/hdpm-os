import { redirect } from 'next/navigation';
import { requireCompanySession } from '@/lib/require-role';
import DeskDemo from './desk-demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Desk (demo) · HDPM OS' };

/**
 * Stage 0 of docs/habu-desk-plan.md — a clickable demo for team buy-in.
 * Access is the "desk_demo" section (admins by default; switch on for others
 * in Admin → User settings). Sample data only; nothing is saved.
 */
export default async function DeskDemoPage() {
  const guard = await requireCompanySession();
  if (!guard.ok) redirect('/login');
  return <DeskDemo />;
}
