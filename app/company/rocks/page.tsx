import { getSupabaseAdmin } from '@/lib/supabase';
import { currentQuarter } from '@/lib/eos/rock';
import RocksBoard from '@/components/eos/RocksBoard';
import type { Rock, Seat } from '@/lib/eos/types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'HDPM-OS — Rocks',
};

/**
 * Company → Rocks (Phase 2, Brief 2E). Quarter board by owner/seat with
 * on/off badges; Friday one-tap self-report lands via Slack. Rocks are
 * properly set in the quarterly meeting — until that ships, + Rock here.
 */
export default async function RocksPage() {
  const supabase = getSupabaseAdmin();
  const quarter = currentQuarter(new Date());

  const [rocksRes, seatsRes, staffRes] = await Promise.all([
    supabase
      .from('rock')
      .select('*')
      .eq('org_id', 'hdpm')
      .order('quarter', { ascending: false })
      .order('due_on', { ascending: true, nullsFirst: false }),
    supabase.from('seat').select('*').eq('org_id', 'hdpm').eq('active', true),
    supabase.from('staff').select('person').eq('active', true).order('person'),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight text-charcoal-900">Rocks</h1>
      <p className="mb-6 text-sm text-charcoal-500">
        The quarter&rsquo;s 3–7 most important things, each with one owner. Owners get a one-tap
        on/off check every Friday on Slack; off-track Rocks get discussed in the weekly meeting.
      </p>
      <RocksBoard
        rocks={(rocksRes.data ?? []) as Rock[]}
        seats={(seatsRes.data ?? []) as Seat[]}
        staff={(staffRes.data ?? []).map((s) => s.person as string)}
        quarter={quarter}
      />
      <p className="mt-6 text-xs text-charcoal-400">
        Data: rock · Friday check rides the 3 PM scorecard cron · Set properly in the quarterly
        meeting (Phase 2.5)
      </p>
    </div>
  );
}
