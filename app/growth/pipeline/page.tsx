import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { WEBSITE_URL } from '@/lib/hdpm-web-admin';
import { PipelineBoard } from './board';

export const metadata = { title: 'Owner pipeline · HDPM OS' };

export default async function PipelinePage() {
  const guard = await requireSection('growth');
  if (!guard.ok) redirect('/');
  return <PipelineBoard websiteUrl={WEBSITE_URL} />;
}
