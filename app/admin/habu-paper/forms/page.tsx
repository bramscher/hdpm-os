import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canViewHabuDemo } from '@/lib/habu-demo-access';
import FormDraftLibrary from './form-draft-library';
import './form-drafts.css';

export const metadata = { title: 'Form Drafts — HABU', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function FormDraftsPage() {
  const session = await auth();
  if (!canViewHabuDemo(session?.user)) notFound();
  return <FormDraftLibrary />;
}
