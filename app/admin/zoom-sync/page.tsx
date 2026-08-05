import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ZoomSyncDashboard } from './zoom-sync-dashboard';

export const metadata = {
  title: 'Zoom Phone Sync — HDPM',
};

export default async function ZoomSyncPage() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  return (
    <div className="px-8 py-8 max-w-5xl">
      <ZoomSyncDashboard />
    </div>
  );
}
