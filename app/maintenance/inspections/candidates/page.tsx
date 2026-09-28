import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CandidatesView } from './candidates-table';

export default async function CandidatesPage({searchParams}: {searchParams: Promise<{group?: string}>}) {
  const session = await auth();

  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    redirect('/login');
  }

  const {group} = await searchParams;
  const initialGroup = group && ['ready','handled','confirmation'].includes(group) ? group : 'ready';
  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <CandidatesView initialGroup={initialGroup} />
      </div>
    </main>
  );
}
