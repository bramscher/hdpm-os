/**
 * Knowledge capture pipeline (server only).
 *
 *   recording uploaded → transcribe → distill notes → brain chunks
 *   → regenerate the subject's profile → brain_node summary + profile chunk
 *
 * Brain identity: owners/properties are brain_node stubs pointing at AppFolio
 * (slug 'owner:appfolio:<id>' / 'property:appfolio:<id>'), linked by 'owns'
 * edges. Chunks are keyed so re-processing replaces instead of duplicating:
 *   kc:rec:<recordingId>:t<n>   transcript windows (kind fact, human author)
 *   kc:rec:<recordingId>:n<n>   distilled notes (kind summary, agent author)
 *   kc:profile:<type>:<id>      the living profile (kind summary)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase';
import { loadFeeFacts } from '@/lib/fee-management/facts-cache';
import { ingestChunk } from '@/lib/brain/ingest';
import { chunkMarkdown } from '@/lib/brain/chunk';
import { buildRoster, type Roster, type SubjectType } from './roster';
import {
  SYNTH_MODEL,
  TRANSCRIBE_MODEL,
  distillNotes,
  synthesizeProfile,
  transcribeAudio,
  type SubjectContext,
} from './synthesize';

export const ORG = 'hdpm';
export const BUCKET = 'knowledge-capture';
const AUTHOR = 'agent:knowledge-capture';

export function nodeSlug(type: SubjectType, id: string): string {
  return `${type}:appfolio:${id}`;
}

/** Split a transcript into ~maxChars windows at sentence boundaries. Pure — unit tested. */
export function splitTranscript(text: string, maxChars = 1800): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [];
  const out: string[] = [];
  let buf = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (buf && buf.length + s.length + 1 > maxChars) {
      out.push(buf);
      buf = '';
    }
    // A single run-on "sentence" beyond the limit is hard-sliced.
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) out.push(buf);
  return out;
}

export async function loadRoster(db: SupabaseClient, refresh = false): Promise<{ roster: Roster; capturedAt: string }> {
  const { facts, capturedAt } = await loadFeeFacts(db, { refresh });
  return { roster: buildRoster(facts), capturedAt };
}

export interface ResolvedSubject {
  type: SubjectType;
  id: string;
  name: string;
  context: SubjectContext;
  /** Related subjects for 'owns' edges: an owner's properties, or a property's owners. */
  related: { type: SubjectType; id: string; name: string }[];
}

/** Find a subject in the AppFolio roster; null if it is not an active owner/property. */
export function resolveSubject(roster: Roster, type: SubjectType, id: string): ResolvedSubject | null {
  if (type === 'owner') {
    const o = roster.owners.find((x) => x.id === id);
    if (!o) return null;
    const facts = [
      `- Owner: ${o.name}`,
      `- Properties managed by HDPM (${o.properties.length}, ${o.doors} doors): ${o.properties.map((p) => p.name).join('; ') || 'none'}`,
    ].join('\n');
    return {
      type,
      id,
      name: o.name,
      context: { type, name: o.name, facts },
      related: o.properties.map((p) => ({ type: 'property' as const, id: p.id, name: p.name })),
    };
  }
  const p = roster.properties.find((x) => x.id === id);
  if (!p) return null;
  const facts = [
    `- Property: ${p.name}`,
    p.address ? `- Address: ${p.address}` : null,
    `- Doors: ${p.doors}`,
    `- Owner(s): ${p.owners.map((o) => o.name).join(' & ') || 'none on file'}`,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    type,
    id,
    name: p.name,
    context: { type, name: p.name, facts },
    related: p.owners.map((o) => ({ type: 'owner' as const, id: o.id, name: o.name })),
  };
}

async function upsertNode(
  db: SupabaseClient,
  s: { type: SubjectType; id: string; name: string },
  summary?: string
): Promise<string> {
  const row: Record<string, unknown> = {
    org_id: ORG,
    entity_type: s.type,
    slug: nodeSlug(s.type, s.id),
    title: s.name,
    source_system: 'appfolio',
    source_ref: s.id,
    sensitivity: 'internal',
    updated_at: new Date().toISOString(),
  };
  if (summary !== undefined) row.summary_md = summary;
  const { data, error } = await db
    .from('brain_node')
    .upsert(row, { onConflict: 'org_id,slug' })
    .select('id')
    .single();
  if (error) throw new Error(`brain_node upsert failed: ${error.message}`);
  return data.id as string;
}

/** Ensure the subject's node, its related nodes, and the 'owns' edges between them. */
async function ensureGraph(db: SupabaseClient, subject: ResolvedSubject): Promise<string> {
  const nodeId = await upsertNode(db, subject);
  for (const r of subject.related) {
    const relId = await upsertNode(db, r);
    const [owner, property] = subject.type === 'owner' ? [nodeId, relId] : [relId, nodeId];
    const { error } = await db
      .from('brain_edge')
      .upsert(
        { src_node_id: owner, dst_node_id: property, relation: 'owns' },
        { onConflict: 'src_node_id,dst_node_id,relation', ignoreDuplicates: true }
      );
    if (error) console.error('[knowledge-capture] edge upsert failed:', error.message);
  }
  return nodeId;
}

const recordedOn = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });

/** Remove a recording's brain chunks (re-process / delete). */
export async function deleteRecordingChunks(db: SupabaseClient, recordingId: string): Promise<void> {
  const { error } = await db
    .from('brain_chunk')
    .delete()
    .eq('org_id', ORG)
    .like('source_key', `kc:rec:${recordingId}:%`);
  if (error) console.error('[knowledge-capture] chunk cleanup failed:', error.message);
}

interface RecordingRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  subject_name: string;
  speaker_email: string;
  speaker_name: string | null;
  storage_path: string;
  mime_type: string;
  created_at: string;
}

/** Transcribe → notes → brain → profile. Leaves the row 'done' or 'error'. */
export async function processRecording(recordingId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data: rec, error } = await db
    .from('kc_recording')
    .select('id, subject_type, subject_id, subject_name, speaker_email, speaker_name, storage_path, mime_type, created_at')
    .eq('org_id', ORG)
    .eq('id', recordingId)
    .maybeSingle<RecordingRow>();
  if (error || !rec) throw new Error('Recording not found');

  const setRow = (patch: Record<string, unknown>) =>
    db.from('kc_recording').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', rec.id);

  await setRow({ status: 'processing', error: null });
  try {
    const { roster } = await loadRoster(db);
    const subject =
      resolveSubject(roster, rec.subject_type, rec.subject_id) ??
      // Subject left AppFolio's active list since recording: keep the knowledge anyway.
      ({
        type: rec.subject_type,
        id: rec.subject_id,
        name: rec.subject_name,
        context: { type: rec.subject_type, name: rec.subject_name, facts: `- ${rec.subject_name} (no longer active in AppFolio)` },
        related: [],
      } satisfies ResolvedSubject);

    const { data: audio, error: dlErr } = await db.storage.from(BUCKET).download(rec.storage_path);
    if (dlErr || !audio) throw new Error(`Audio download failed: ${dlErr?.message ?? 'missing'}`);

    const speaker = rec.speaker_name || rec.speaker_email;
    const { text: transcript, durationSec } = await transcribeAudio(audio, rec.mime_type, subject.name);
    if (!transcript) throw new Error('Transcription came back empty — was the microphone muted?');
    await setRow({ transcript, transcript_model: TRANSCRIBE_MODEL, duration_sec: durationSec, size_bytes: audio.size });

    const notes = await distillNotes(subject.context, transcript, speaker, recordedOn(rec.created_at));
    const nodeId = await ensureGraph(db, subject);

    await deleteRecordingChunks(db, rec.id);
    const label = subject.type === 'owner' ? 'Owner' : 'Property';
    const header = `${label}: ${subject.name} — ${speaker}, recorded ${recordedOn(rec.created_at)}`;
    const common = {
      sourceTable: 'kc_recording',
      sourceId: rec.id,
      sourceUrl: `/knowledge-capture?${subject.type}=${encodeURIComponent(subject.id)}`,
      domain: 'company' as const,
      sensitivity: 'internal' as const,
      nodeId,
    };
    const windows = splitTranscript(transcript);
    let chunks = 0;
    for (const [i, w] of windows.entries()) {
      const action = await ingestChunk(
        {
          ...common,
          content: `${header} — transcript part ${i + 1}/${windows.length}\n\n${w}`,
          kind: 'fact',
          sourceKey: `kc:rec:${rec.id}:t${i}`,
          author: `human:${rec.speaker_email}`,
        },
        'knowledge-capture'
      );
      if (action !== 'error') chunks++;
    }
    for (const c of chunkMarkdown(notes, header)) {
      const action = await ingestChunk(
        { ...common, content: c.content, kind: 'summary', sourceKey: `kc:rec:${rec.id}:n${c.index}`, author: AUTHOR },
        'knowledge-capture'
      );
      if (action !== 'error') chunks++;
    }

    await setRow({ status: 'done', notes_md: notes, chunk_count: chunks });
    await regenerateProfile(subject.type, subject.id, subject);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[knowledge-capture] processing ${rec.id} failed:`, message);
    await setRow({ status: 'error', error: message.slice(0, 500) });
    throw err;
  }
}

/**
 * Rebuild a subject's profile from every finished recording. With no
 * recordings left (all deleted), the profile and its brain chunk are removed.
 */
export async function regenerateProfile(
  type: SubjectType,
  id: string,
  resolved?: ResolvedSubject
): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data: recs, error } = await db
    .from('kc_recording')
    .select('subject_name, speaker_email, speaker_name, notes_md, created_at')
    .eq('org_id', ORG)
    .eq('subject_type', type)
    .eq('subject_id', id)
    .eq('status', 'done')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  const profileKey = `kc:profile:${type}:${id}`;
  const withNotes = (recs ?? []).filter((r) => r.notes_md);
  if (!withNotes.length) {
    await db.from('kc_profile').delete().eq('org_id', ORG).eq('subject_type', type).eq('subject_id', id);
    await db.from('brain_chunk').delete().eq('org_id', ORG).eq('source_key', profileKey);
    return null;
  }

  let subject = resolved;
  if (!subject) {
    const { roster } = await loadRoster(db);
    subject = resolveSubject(roster, type, id) ?? undefined;
  }
  const name = subject?.name ?? withNotes[withNotes.length - 1].subject_name;
  const context = subject?.context ?? { type, name, facts: `- ${name} (no longer active in AppFolio)` };

  const profile = await synthesizeProfile(
    context,
    withNotes.map((r) => ({
      speaker: r.speaker_name || r.speaker_email,
      recordedOn: recordedOn(r.created_at),
      notes: r.notes_md as string,
    }))
  );

  // Edges were laid down when the recordings were processed.
  const nodeId = await upsertNode(db, { type, id, name }, profile);
  const label = type === 'owner' ? 'Owner' : 'Property';
  await ingestChunk(
    {
      content: `${label} profile: ${name} (from Matt & Penny's recorded knowledge)\n\n${profile}`,
      kind: 'summary',
      sourceKey: profileKey,
      sourceTable: 'kc_profile',
      sourceId: `${type}:${id}`,
      sourceUrl: `/knowledge-capture?${type}=${encodeURIComponent(id)}`,
      author: AUTHOR,
      domain: 'company',
      sensitivity: 'internal',
      nodeId,
      salience: 1.2,
    },
    'knowledge-capture'
  );

  const { error: upErr } = await db.from('kc_profile').upsert(
    {
      org_id: ORG,
      subject_type: type,
      subject_id: id,
      subject_name: name,
      profile_md: profile,
      recording_count: withNotes.length,
      model: SYNTH_MODEL,
      brain_node_id: nodeId,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,subject_type,subject_id' }
  );
  if (upErr) throw new Error(upErr.message);
  return profile;
}
