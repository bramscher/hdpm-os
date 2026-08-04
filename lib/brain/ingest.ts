/**
 * Brain ingestion (Phase 1, Brief 1A).
 *
 * Idempotent by source_key: re-ingesting the same key with unchanged content
 * is a skip; changed content updates in place (re-embeds); keyless chunks
 * always insert. Every action logs to brain_ingest_log. Callers are
 * responsible for the doc 04 ingestion allowlist — this module does not
 * decide *what* deserves to be remembered.
 */

import { createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { embedText } from './embed';
import type { IngestInput } from './types';

export function contentHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

export type IngestAction = 'add' | 'update' | 'skip' | 'error';

async function log(source: string, ref: string | null, action: IngestAction, reason?: string) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from('brain_ingest_log').insert({ source, ref, action, reason: reason ?? null });
  } catch {
    /* best-effort */
  }
}

export async function ingestChunk(input: IngestInput, source = 'manual'): Promise<IngestAction> {
  const supabase = getSupabaseAdmin();
  const hash = contentHash(input.content);

  try {
    if (input.sourceKey) {
      const { data: existing } = await supabase
        .from('brain_chunk')
        .select('id, content_hash')
        .eq('org_id', 'hdpm')
        .eq('source_key', input.sourceKey)
        .maybeSingle();

      if (existing?.content_hash === hash) {
        await supabase
          .from('brain_chunk')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existing.id);
        await log(source, input.sourceKey, 'skip', 'unchanged');
        return 'skip';
      }

      const embedding = await embedText(input.content);
      if (existing) {
        const { error } = await supabase
          .from('brain_chunk')
          .update({
            content: input.content,
            content_hash: hash,
            embedding,
            kind: input.kind,
            domain: input.domain ?? 'ops',
            sensitivity: input.sensitivity ?? 'internal',
            author: input.author ?? 'system',
            source_url: input.sourceUrl ?? null,
            source_table: input.sourceTable ?? null,
            source_id: input.sourceId ?? null,
            node_id: input.nodeId ?? null,
            salience: input.salience ?? 1.0,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (error) throw new Error(error.message);
        await log(source, input.sourceKey, 'update');
        return 'update';
      }
    }

    const embedding = await embedText(input.content);
    const { error } = await supabase.from('brain_chunk').insert({
      content: input.content,
      content_hash: hash,
      source_key: input.sourceKey ?? null,
      embedding,
      kind: input.kind,
      domain: input.domain ?? 'ops',
      sensitivity: input.sensitivity ?? 'internal',
      author: input.author ?? 'system',
      source_url: input.sourceUrl ?? null,
      source_table: input.sourceTable ?? null,
      source_id: input.sourceId ?? null,
      node_id: input.nodeId ?? null,
      salience: input.salience ?? 1.0,
    });
    if (error) throw new Error(error.message);
    await log(source, input.sourceKey ?? null, 'add');
    return 'add';
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[brain] ingest failed (${input.sourceKey ?? 'keyless'}):`, reason);
    await log(source, input.sourceKey ?? null, 'error', reason.slice(0, 500));
    return 'error';
  }
}

/**
 * Record a human correction: inserts the correction chunk and supersedes the
 * old one (retrieval hides superseded rows). Doc 04 §4 propagation rule.
 */
export async function ingestCorrection(
  supersededChunkId: string,
  correction: Omit<IngestInput, 'kind'>,
  correctedBy: string
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const embedding = await embedText(correction.content);
  const { data, error } = await supabase
    .from('brain_chunk')
    .insert({
      content: correction.content,
      content_hash: contentHash(correction.content),
      source_key: correction.sourceKey ?? null,
      embedding,
      kind: 'human_correction',
      domain: correction.domain ?? 'ops',
      sensitivity: correction.sensitivity ?? 'internal',
      author: `human:${correctedBy}`,
      source_url: correction.sourceUrl ?? null,
      salience: 1.5, // corrections outrank what they replace
    })
    .select('id')
    .single();
  if (error) {
    console.error('[brain] correction insert failed:', error.message);
    return null;
  }
  await supabase
    .from('brain_chunk')
    .update({ superseded_by: data.id })
    .eq('id', supersededChunkId);
  await log('correction', supersededChunkId, 'update', `superseded by ${data.id}`);
  return data.id;
}
