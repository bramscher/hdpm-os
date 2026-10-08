import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { KnowledgeCapture } from './knowledge-capture';

export const metadata = { title: 'Knowledge Capture · HDPM OS' };

export default async function KnowledgeCapturePage() {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) redirect('/');
  return <KnowledgeCapture />;
}
