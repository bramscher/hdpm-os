import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canViewHabuDemo } from '@/lib/habu-demo-access';
import { createExamples } from '@/lib/habu-paper/model';
import PaperDemo from './paper-demo';
import './paper-demo.css';

export const metadata = { title: 'Paper Workflows — HABU Demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function PaperWorkflowPage() {
  const session = await auth();
  if (!canViewHabuDemo(session?.user)) notFound();
  return <PaperDemo initialSheets={createExamples()} />;
}
