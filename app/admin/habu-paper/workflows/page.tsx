import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canViewHabuDemo } from '@/lib/habu-demo-access';
import { reviewExamples } from '@/lib/habu-paper/review';
import WorkflowReview from './workflow-review';
import './workflow-review.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Work — HABU Review', robots: { index: false, follow: false } };
export default async function Page() {
  if (!canViewHabuDemo((await auth())?.user)) notFound();
  return <WorkflowReview initial={reviewExamples()} />;
}
