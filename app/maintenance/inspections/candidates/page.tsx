import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { CandidatesView } from './candidates-table';

export default async function CandidatesPage() {
  const session = await auth();

  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    redirect('/login');
  }

  return (
    <main className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        <CandidatesView />
      </div>
    </main>
  );
}
