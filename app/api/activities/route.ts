import { NextRequest, NextResponse } from 'next/server';
import { requireCompanySession } from '@/lib/require-role';
import { reportsApiConfigured } from '@/lib/appfolio-reports';
import { todayPacific } from '@/lib/eos/escalation';
import { activitiesForStaff, bucketActivities, staffForAssignee, type Activity } from '@/lib/activities';
import { fetchActivities, loadActiveStaff } from '@/lib/activities-server';

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
    if (requested) {
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

    let people: Array<{ name: string; count: number; hidden: boolean; staff: boolean }> | undefined;
    if (isAdmin) {
      const byName = new Map<string, { name: string; count: number; hidden: boolean; staff: boolean }>();
      for (const a of rows) {
        const name = a.assignee ?? '(unassigned)';
        const entry = byName.get(name) ?? { name, count: 0, hidden: a.assigneeHidden, staff: Boolean(staffForAssignee(a.assignee, staff)) };
        entry.count += 1;
        byName.set(name, entry);
      }
      people = [...byName.values()].sort((a, b) => b.count - a.count);
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
