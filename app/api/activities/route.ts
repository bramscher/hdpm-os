import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { reportsApiConfigured } from '@/lib/appfolio-reports';
import { todayPacific } from '@/lib/eos/escalation';
import { activitiesForStaff, activityPeople, bucketActivities, staffForAssignee, type Activity, type ActivityPerson } from '@/lib/activities';
import { fetchActivities, loadActiveStaff } from '@/lib/activities-server';
import { getDeniedSections } from '@/lib/access/section-access';
import { hiddenFromRoster } from '@/lib/access/roster';

export const maxDuration = 60;

/**
 * GET /api/activities — the signed-in user's pending AppFolio activities,
 * bucketed by due date. Admins may pass ?person=<assignee name> to view
 * anyone's list (including deactivated/unmatched AppFolio users); for
 * everyone else the param is ignored and they get their own list.
 */
export async function GET(request: NextRequest) {
  const guard = await requireCompanySession();
  if (!guard.ok) return guard.response;
  if (!reportsApiConfigured()) {
    return NextResponse.json({ error: 'AppFolio Reports API is not configured' }, { status: 503 });
  }

  try {
    const [{ rows, fetchedAt }, staff] = await Promise.all([
      fetchActivities({ fresh: request.nextUrl.searchParams.get('refresh') === '1' }),
      loadActiveStaff(),
    ]);
    const me = staff.find((s) => s.email?.toLowerCase() === guard.email.toLowerCase()) ?? null;
    const isAdmin = guard.role === 'admin';
    const today = todayPacific(new Date());

    const requested = isAdmin ? request.nextUrl.searchParams.get('person')?.trim() : null;
    let viewing: string;
    let mine: Activity[];
    const requestedStaff = requested ? staffForAssignee(requested, staff) : null;
    if (requested && requestedStaff) {
      viewing = requestedStaff.name ?? requestedStaff.person;
      mine = activitiesForStaff(rows, requestedStaff);
    } else if (requested) {
      viewing = requested;
      mine = rows.filter((a) => (a.assignee ?? '(unassigned)').toLowerCase() === requested.toLowerCase());
    } else if (me) {
      viewing = me.name ?? me.person;
      mine = activitiesForStaff(rows, me);
    } else {
      viewing = guard.name ?? guard.email;
      mine = [];
    }

    const buckets = bucketActivities(mine, today);
    const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));

    // Same roster as Admin → User settings (hidden identities such as Bryce stay out),
    // minus anyone with the Activities section switched off there.
    let people: ActivityPerson[] | undefined;
    if (isAdmin) {
      const rostered = staff.filter((s) => !hiddenFromRoster(s.person) && !hiddenFromRoster(s.email) && !hiddenFromRoster(s.name));
      const listed = (
        await Promise.all(
          rostered.map(async (s) => ((await getDeniedSections(s.email, s.access_role ?? undefined)).includes('activities') ? null : s))
        )
      ).filter((s): s is (typeof staff)[number] => s !== null);
      people = activityPeople(rows, listed);
    }

    return NextResponse.json({
      viewing,
      matchedStaff: requested ? Boolean(staffForAssignee(requested, staff)) : Boolean(me),
      today,
      fetchedAt,
      counts,
      buckets,
      isAdmin,
      people,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Activities] load failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
