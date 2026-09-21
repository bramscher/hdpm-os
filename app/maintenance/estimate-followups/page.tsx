import { requireFollowupReviewer } from '@/lib/agents/followup-access';
import { redirect } from 'next/navigation';
import Followups from './followups';
export const metadata = { title: 'Maintenance follow-ups — HDPM' };
export default async function Page() {
  const guard = await requireFollowupReviewer();
  if (!guard.ok) redirect('/maintenance');
  return <Followups/>;
}
