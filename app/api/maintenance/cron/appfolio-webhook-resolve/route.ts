import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { fetchBillById, fetchJournalEntryById } from '@/lib/appfolio';

export const maxDuration = 120;

/**
 * Resolve AppFolio webhook events whose entity couldn't be fetched at receive
 * time. AppFolio's v0 Database API lags the webhook by ~2h, so a bill/journal
 * entry isn't queryable by Id the instant its webhook fires. This re-fetches
 * unresolved bill / journal_entries rows once v0 has caught up.
 *
 * Auth: CRON_SECRET bearer (Vercel cron), or an admin session for manual runs.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const { requireAdmin } = await import('@/lib/require-admin');
    const guard = await requireAdmin();
    if (!guard.ok) return guard.response;
  }

  try {
    const supabase = getSupabaseAdmin();

    // Unresolved financial rows we have a fetcher for, from the last 4 days.
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('appfolio_webhook_log')
      .select('id, topic, entity_id')
      .is('entity', null)
      .is('fetch_error', null)
      .gte('received_at', fourDaysAgo)
      .order('received_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    let resolved = 0;
    let stillPending = 0;
    let failed = 0;

    for (const row of rows || []) {
      const topic: string = row.topic;
      const entityId: string | null = row.entity_id;
      if (!entityId) continue;

      const isJournal = /journal|ledger/i.test(topic);
      const isBill = /bill/i.test(topic);
      if (!isJournal && !isBill) continue;

      try {
        const entity = isJournal
          ? await fetchJournalEntryById(entityId)
          : await fetchBillById(entityId);

        if (entity) {
          await supabase.from('appfolio_webhook_log').update({ entity }).eq('id', row.id);
          resolved++;
        } else {
          // Still not in v0 (lag) — leave it for the next run.
          stillPending++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase.from('appfolio_webhook_log').update({ fetch_error: msg }).eq('id', row.id);
        failed++;
      }
    }

    console.log(
      `[WebhookResolve] resolved=${resolved} stillPending=${stillPending} failed=${failed} of ${rows?.length ?? 0}`
    );
    return NextResponse.json({ scanned: rows?.length ?? 0, resolved, stillPending, failed });
  } catch (error) {
    console.error('[WebhookResolve] error:', error);
    const message = error instanceof Error ? error.message : 'Resolve failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
