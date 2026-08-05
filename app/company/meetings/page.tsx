import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase';
import { weekStartPacific, weeksBefore } from '@/lib/eos/scorecard';
import { isConcluded } from '@/lib/eos/meeting';
import StartMeetingButton from '@/components/eos/StartMeetingButton';
import type { Meeting } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Meetings',
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
}

/**
 * Company → Meetings (Phase 2, Brief 2D). This week's meeting up top
 * (with its Monday prep packet), archive below. The runner lives at
 * /company/meetings/[id].
 */
export default async function MeetingsPage() {
  const supabase = getSupabaseAdmin();
  const weekStart = weekStartPacific(new Date());
  const weekEnd = weeksBefore(weekStart, -1);

  const { data } = await supabase
    .from('meeting')
    .select('id, kind, starts_at, rating, minutes_md, facilitator_person, prep_packet_md')
    .eq('org_id', 'hdpm')
    .order('starts_at', { ascending: false })
    .limit(26);
  const meetings = (data ?? []) as Meeting[];
  const thisWeek = meetings.find(
    (m) => m.starts_at >= `${weekStart}T00:00:00` && m.starts_at < `${weekEnd}T00:00:00`
  );
  const archive = meetings.filter((m) => m.id !== thisWeek?.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-charcoal-900">Meetings</h1>
      <p className="mb-6 text-sm text-charcoal-500">
        The weekly cadence: same agenda, same order, run from one screen. The prep packet lands
        Monday morning; solving an issue requires an outcome.
      </p>

      <div className="mb-8 rounded-xl border border-sand-200 bg-white shadow-card p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-500">
          Week of {weekStart}
        </h2>
        {thisWeek ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-charcoal-900">
                {thisWeek.kind} · {fmtDate(thisWeek.starts_at)}
                {thisWeek.facilitator_person ? ` · ${thisWeek.facilitator_person}` : ''}
              </p>
              <p className="text-xs text-charcoal-500">
                {thisWeek.prep_packet_md ? 'Prep packet ready' : 'Prep packet lands Monday 7:30 AM'}
                {isConcluded(thisWeek) ? ` · concluded${thisWeek.rating ? ` (${thisWeek.rating}/10)` : ''}` : ''}
              </p>
            </div>
            <Link
              href={`/company/meetings/${thisWeek.id}`}
              className="rounded-lg bg-terra-500 hover:bg-terra-600 transition-colors px-3 py-1.5 text-sm font-medium text-white"
            >
              {isConcluded(thisWeek) ? 'View' : 'Open runner'}
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm text-charcoal-500">No meeting scheduled this week.</p>
            <StartMeetingButton />
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-charcoal-500">Archive</h2>
      <div className="rounded-xl border border-sand-200 bg-white shadow-card">
        {archive.map((m) => (
          <Link
            key={m.id}
            href={`/company/meetings/${m.id}`}
            className="flex items-center gap-3 border-b border-sand-100 px-3 py-2.5 text-sm last:border-b-0 hover:bg-sand-50"
          >
            <span className="font-medium text-charcoal-900">{fmtDate(m.starts_at)}</span>
            <span className="text-charcoal-500">{m.kind}</span>
            <span className="flex-1" />
            {m.rating ? <span className="text-xs text-charcoal-500">rated {m.rating}/10</span> : null}
            {!isConcluded(m) ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                not concluded
              </span>
            ) : null}
          </Link>
        ))}
        {archive.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-charcoal-400">
            No meetings yet — the archive builds itself as you run them.
          </p>
        ) : null}
      </div>
      <p className="mt-6 text-xs text-charcoal-400">
        Data: meeting, meeting_item, decision · Prep: Monday 7:30 AM PT · Minutes & decisions feed
        the company brain
      </p>
    </div>
  );
}
