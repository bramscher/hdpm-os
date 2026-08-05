import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { weekStartPacific, weeksBefore } from '@/lib/eos/scorecard';
import { buildAgenda, type AgendaStep } from '@/lib/eos/meeting';
import MeetingRunner from '@/components/eos/MeetingRunner';
import type { Meeting, ScorecardMetric, ScorecardEntry, Issue, Todo, Decision } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Meeting',
};

/**
 * The meeting runner / archive view (Phase 2, Brief 2D). Server component
 * gathers everything each agenda step needs; MeetingRunner drives the
 * stepper + timer client-side.
 */
export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  const { data: meetingRow } = await supabase
    .from('meeting')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!meetingRow) notFound();
  const meeting = meetingRow as Meeting;

  const currentWeek = weekStartPacific(new Date());
  const prevWeek = weeksBefore(currentWeek, 1);

  const [metricsRes, entriesRes, issuesRes, lastWeekTodosRes, meetingTodosRes, decisionsRes, itemsRes, staffRes] =
    await Promise.all([
      supabase
        .from('scorecard_metric')
        .select('*')
        .eq('org_id', 'hdpm')
        .eq('active', true)
        .order('sort'),
      supabase.from('scorecard_entry').select('*').gte('week_start', weeksBefore(currentWeek, 1)),
      supabase
        .from('issue')
        .select('*')
        .eq('org_id', 'hdpm')
        .in('status', ['open', 'discussed'])
        .order('priority')
        .order('created_at'),
      supabase
        .from('todo')
        .select('*')
        .eq('org_id', 'hdpm')
        .gte('due_on', prevWeek)
        .lt('due_on', currentWeek),
      supabase
        .from('todo')
        .select('*')
        .eq('org_id', 'hdpm')
        .in('source', ['issue', 'meeting'])
        .gte('created_at', meeting.created_at)
        .order('created_at'),
      supabase
        .from('decision')
        .select('*')
        .eq('decided_in_meeting_id', id)
        .order('created_at'),
      supabase.from('meeting_item').select('*').eq('meeting_id', id).order('sort'),
      supabase.from('staff').select('person').eq('active', true).order('person'),
    ]);

  const agenda =
    Array.isArray(meeting.agenda) && meeting.agenda.length > 0
      ? (meeting.agenda as unknown as AgendaStep[])
      : buildAgenda(meeting.kind);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <MeetingRunner
        meeting={meeting}
        agenda={agenda}
        metrics={(metricsRes.data ?? []) as ScorecardMetric[]}
        entries={(entriesRes.data ?? []) as ScorecardEntry[]}
        currentWeek={currentWeek}
        prevWeek={prevWeek}
        issues={(issuesRes.data ?? []) as Issue[]}
        lastWeekTodos={(lastWeekTodosRes.data ?? []) as Todo[]}
        meetingTodos={(meetingTodosRes.data ?? []) as Todo[]}
        decisions={(decisionsRes.data ?? []) as Decision[]}
        idsItemCount={(itemsRes.data ?? []).filter((i) => i.kind === 'ids').length}
        staff={(staffRes.data ?? []).map((s) => s.person as string)}
      />
    </div>
  );
}
