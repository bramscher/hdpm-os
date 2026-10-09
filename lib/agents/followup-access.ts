import { NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { resolveStaffByPersonOrEmail } from './staff';
import { getNotifyRecipients } from './config';

/** Used until people are assigned to the Maintenance Follow-up Queue on the Agents page. */
export const FOLLOWUP_DEFAULT_TEAM = ['Brody', 'Craig'];
export const FOLLOWUP_REVIEWERS_DENIED = 'Only people assigned to the Maintenance Follow-up Queue on the Agents page can review it.';
/** The follow-up team, in order: team_review's assigned people (Agents page), else the default. */
export async function followupTeam() {
  return getNotifyRecipients('estimate_chaser', 'team_review', FOLLOWUP_DEFAULT_TEAM);
}
export async function canReviewFollowups(email: string): Promise<boolean> {
  const staff = await resolveStaffByPersonOrEmail(email);
  if (!staff?.email) return false;
  return (await followupTeam()).some(s => s.email?.toLowerCase() === staff.email!.toLowerCase());
}
export async function requireFollowupReviewer() {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard;
  return await canReviewFollowups(guard.email) ? guard : {
    ok: false as const, response: NextResponse.json({ error: FOLLOWUP_REVIEWERS_DENIED }, { status: 403 }),
  };
}
