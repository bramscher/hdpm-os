/**
 * agent_outbox — enqueue + dispatch.
 *
 * Retry semantics mirror recordNoticeResults (lib/inspection-notify.ts):
 * failures stay queued so the next dispatch pass retries them, until the
 * attempt cap parks them as terminal 'failed'. 'skipped' is terminal.
 * Single-dispatcher assumption for now (manual/cron); add FOR UPDATE SKIP
 * LOCKED if two dispatchers can ever overlap.
 */

import { getSupabaseAdmin } from './db';
import type { AgentChannel, OutboxMessage } from './types';
import { MAX_SEND_ATTEMPTS } from './types';
import { getAdapter, type SendOutcome } from './channels';
import { isGloballyKilled } from './config';

export interface NewOutboxMessage {
  proposal_id?: string | null;
  channel: AgentChannel;
  recipient_person?: string | null;
  recipient_address?: string | null;
  subject?: string | null;
  body?: string | null;
  payload?: Record<string, unknown>;
}

export async function enqueueOutbox(msg: NewOutboxMessage): Promise<OutboxMessage> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('agent_outbox')
    .insert({
      proposal_id: msg.proposal_id ?? null,
      channel: msg.channel,
      recipient_person: msg.recipient_person ?? null,
      recipient_address: msg.recipient_address ?? null,
      subject: msg.subject ?? null,
      body: msg.body ?? null,
      payload: msg.payload ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Outbox enqueue failed: ${error?.message}`);
  return data as OutboxMessage;
}

/**
 * Pure per-row outcome → update mapping (unit-tested).
 * Always bumps attempts + last_attempt_at; a failure below the cap keeps the
 * row queued (retryable), at the cap it parks as 'failed'.
 */
export function outboxUpdateFor(
  row: Pick<OutboxMessage, 'attempts'>,
  outcome: SendOutcome,
  now: Date
): Record<string, unknown> {
  const attempts = row.attempts + 1;
  const base = { attempts, last_attempt_at: now.toISOString() };

  if (outcome.status === 'sent') {
    return {
      ...base,
      status: 'sent',
      sent_at: now.toISOString(),
      message_id: outcome.message_id ?? null,
      error: null,
    };
  }
  if (outcome.status === 'skipped') {
    return { ...base, status: 'skipped', error: outcome.error ?? null };
  }
  // failed: retryable until the cap
  return {
    ...base,
    status: attempts < MAX_SEND_ATTEMPTS ? 'queued' : 'failed',
    error: outcome.error ?? 'send failed',
  };
}

export interface DispatchSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  parked: number;
  halted?: string;
}

export async function dispatchOutbox(options: {
  channel?: AgentChannel;
  limit?: number;
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { processed: 0, sent: 0, failed: 0, skipped: 0, parked: 0 };
  const now = options.now ?? new Date();

  if (await isGloballyKilled()) {
    console.log('[Agents] dispatch halted: kill switch');
    return { ...summary, halted: 'kill switch' };
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('agent_outbox')
    .select('*')
    .eq('status', 'queued')
    .lt('attempts', MAX_SEND_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(options.limit ?? 50);
  if (options.channel) query = query.eq('channel', options.channel);

  const { data, error } = await query;
  if (error) throw new Error(`Outbox read failed: ${error.message}`);
  const rows = (data ?? []) as OutboxMessage[];

  if (options.dryRun) {
    return { ...summary, processed: rows.length };
  }

  for (const row of rows) {
    summary.processed++;
    let outcome: SendOutcome;
    try {
      outcome = await getAdapter(row.channel).send(row);
    } catch (err) {
      outcome = { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }

    const patch = outboxUpdateFor(row, outcome, now);
    const { error: updateError } = await supabase
      .from('agent_outbox')
      .update(patch)
      .eq('id', row.id);
    if (updateError) {
      console.error(`[Agents] outbox update failed for ${row.id}:`, updateError.message);
      continue;
    }

    if (outcome.status === 'sent') summary.sent++;
    else if (outcome.status === 'skipped') summary.skipped++;
    else if (patch.status === 'failed') {
      summary.failed++;
      summary.parked++;
    } else summary.failed++;
  }

  console.log(
    `[Agents] dispatch: ${summary.sent} sent, ${summary.failed} failed (${summary.parked} parked), ${summary.skipped} skipped of ${summary.processed}`
  );
  return summary;
}
