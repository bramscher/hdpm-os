import { NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { resolveStaffByPersonOrEmail } from './staff';

export const FOLLOWUP_REVIEWERS = ['penny@highdesertpm.com', 'craig@highdesertpm.com'];
export async function canReviewFollowups(email: string): Promise<boolean> {
  const staff = await resolveStaffByPersonOrEmail(email);
  return !!staff?.email && FOLLOWUP_REVIEWERS.includes(staff.email.toLowerCase());
}
export async function requireFollowupReviewer() {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  return await canReviewFollowups(guard.email) ? guard : {
    ok: false as const, response: NextResponse.json({ error: 'This trial is reviewed by Penny and Craig.' }, { status: 403 }),
  };
}
