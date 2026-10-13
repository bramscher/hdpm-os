import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { requireSection } from '@/lib/require-role';
import { KnowledgeCapture } from './knowledge-capture';

// Installable as a Home Screen app that records with no signal (public/kc-sw.js).
export const metadata: Metadata = {
  title: 'Knowledge Capture · HDPM OS',
  manifest: '/kc.webmanifest',
  appleWebApp: { capable: true, title: 'Capture', statusBarStyle: 'default' },
  icons: { apple: '/kc-icon-180.png' },
};

export const viewport: Viewport = { themeColor: '#ffffff' };

export default async function KnowledgeCapturePage() {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) redirect('/');
  return <KnowledgeCapture />;
}
