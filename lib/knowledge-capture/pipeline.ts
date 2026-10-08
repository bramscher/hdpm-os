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
import { rowVoices, voiceName, voicesLabel } from './voices';
import {
  aliasMap,
  applyOwnerLinks,
  canonicalOwner,
  ownerIdsFor,
  type LinkedRoster,
  type LinkedRosterOwner,
  type OwnerLink,
} from './links';
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
/** Typed/pasted notes are takes with no audio: this mime and an empty storage_path. */
export const TEXT_MIME = 'text/plain';
export const isTextEntry = (row: { mime_type: string }) => row.mime_type === TEXT_MIME;
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

/** Owner record links (empty until the 20261015 migration is applied). */
export async function loadOwnerLinks(db: SupabaseClient): Promise<OwnerLink[]> {
  const { data, error } = await db
    .from('kc_owner_link')
    .select('owner_id, linked_owner_id, kind, note')
    .eq('org_id', ORG);
  if (error) {
    console.error('[knowledge-capture] owner links unavailable:', error.message);
    return [];
  }
  return (data ?? []) as OwnerLink[];
}

/**
 * The roster with owner links applied (duplicates folded into their kept
 * profile), plus the raw per-record roster and links for suggestions.
 */
export async function loadRoster(
  db: SupabaseClient,
  refresh = false
): Promise<{ roster: LinkedRoster; raw: Roster; links: OwnerLink[]; aliases: Map<string, string>; capturedAt: string }> {
  const [{ facts, capturedAt }, links] = await Promise.all([loadFeeFacts(db, { refresh }), loadOwnerLinks(db)]);
  const raw = buildRoster(facts);
  return { roster: applyOwnerLinks(raw, links), raw, links, aliases: aliasMap(links), capturedAt };
}

/** Owner ids whose recordings feed this subject's profile (merged duplicates included). */
export async function subjectIds(db: SupabaseClient, type: SubjectType, id: string): Promise<string[]> {
  if (type !== 'owner') return [id];
  return ownerIdsFor(aliasMap(await loadOwnerLinks(db)), id);
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
    const o = roster.owners.find((x) => x.id === id) as Partial<LinkedRosterOwner> & Roster['owners'][number] | undefined;
    if (!o) return null;
    const facts = [
      `- Owner: ${o.name}`,
      `- Properties managed by HDPM (${o.properties.length}, ${o.doors} doors): ${o.properties.map((p) => p.name).join('; ') || 'none'}`,
      o.aliases?.length ? `- Also a separate AppFolio owner record as: ${o.aliases.map((a) => a.name).join('; ')} (same person)` : null,
      o.related?.length
        ? `- Related owners (separate profiles): ${o.related.map((r) => (r.note ? `${r.name} (${r.note})` : r.name)).join('; ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
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

/** A run older than this is dead (Vercel stops functions at 300s); it may be retried. */
export const STALE_PROCESSING_MS = 6 * 60 * 1000;

/**
 * Atomically mark a take as processing. Returns false if another live run
 * already holds it, so two clicks can't both pay for Whisper/Claude.
 */
export async function claimRecording(db: SupabaseClient, id: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data, error } = await db
    .from('kc_recording')
    .update({ status: 'processing', error: null, updated_at: new Date().toISOString() })
    .eq('org_id', ORG)
    .eq('id', id)
    .or(`status.neq.processing,updated_at.lt.${staleBefore}`)
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface RecordingRow {
  id: string;
  subject_type: SubjectType;
  subject_id: string;
  subject_name: string;
  speaker_email: string;
  speaker_name: string | null;
  voices: string[] | null;
  storage_path: string;
  mime_type: string;
  transcript: string | null;
  transcript_original: string | null;
  created_at: string;
}

/**
 * Step 1 of 2 for audio: transcribe only. The take is left 'uploaded' with its
 * transcript — "awaiting review" — so a person can read and correct it before
 * anything reaches the brain. processRecording (step 2) runs on approval.
 * Callers claim the row first (claimRecording).
 */
export async function transcribeRecording(recordingId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const { data: rec, error } = await db
    .from('kc_recording')
    .select('id, subject_name, storage_path, mime_type')
    .eq('org_id', ORG)
    .eq('id', recordingId)
    .maybeSingle();
  if (error || !rec) throw new Error('Recording not found');
  const setRow = async (patch: Record<string, unknown>) => {
    const { error: upErr } = await db
      .from('kc_recording')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', rec.id);
    if (upErr) throw new Error(`Could not update the take: ${upErr.message}`);
  };
  try {
    if (isTextEntry(rec)) throw new Error('Typed notes have nothing to transcribe');
    const { data: audio, error: dlErr } = await db.storage.from(BUCKET).download(rec.storage_path);
    if (dlErr || !audio) throw new Error(`Audio download failed: ${dlErr?.message ?? 'missing'}`);
    const result = await transcribeAudio(audio, rec.mime_type, rec.subject_name);
    if (!result.text) throw new Error('Transcription came back empty — was the microphone muted?');
    await setRow({
      status: 'uploaded',
      error: null,
      transcript: result.text,
      transcript_model: TRANSCRIBE_MODEL,
      duration_sec: result.durationSec,
      size_bytes: audio.size,
    });
    return result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[knowledge-capture] transcribing ${rec.id} failed:`, message);
    await setRow({ status: 'error', error: message.slice(0, 500) }).catch(() => undefined);
    throw err;
  }
}

/**
 * Transcribe → notes → brain → profile. Leaves the row 'done' or 'error'.
 *
 * With `edit`, the corrected transcript replaces the stored one (the first
 * machine transcript is kept in transcript_original) and everything
 * downstream is rebuilt from it. Without it, an existing transcript is reused
 * (retries never re-bill transcription or undo an edit); only a take with no
 * transcript yet goes to Whisper.
 */
export async function processRecording(
  recordingId: string,
  edit?: { transcript: string; editedBy: string }
): Promise<void> {
  const db = getSupabaseAdmin();
  const { data: rec, error } = await db
    .from('kc_recording')
    .select('id, subject_type, subject_id, subject_name, speaker_email, speaker_name, voices, storage_path, mime_type, transcript, transcript_original, created_at')
    .eq('org_id', ORG)
    .eq('id', recordingId)
    .maybeSingle<RecordingRow>();
  if (error || !rec) throw new Error('Recording not found');

  const setRow = async (patch: Record<string, unknown>) => {
    const { error: upErr } = await db
      .from('kc_recording')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', rec.id);
    if (upErr) throw new Error(`Could not update the take: ${upErr.message}`);
  };

  // Callers claim the row first (claimRecording); this refresh keeps it fresh.
  await setRow({ status: 'processing', error: null });
  let subjectRef: { type: SubjectType; id: string; resolved: ResolvedSubject } | null = null;
  try {
    const { roster, aliases } = await loadRoster(db);
    // A take recorded on a since-merged duplicate feeds the kept profile.
    const subjectId = rec.subject_type === 'owner' ? canonicalOwner(aliases, rec.subject_id) : rec.subject_id;
    const subject =
      resolveSubject(roster, rec.subject_type, subjectId) ??
      // Subject left AppFolio's active list since recording: keep the knowledge anyway.
      ({
        type: rec.subject_type,
        id: subjectId,
        name: rec.subject_name,
        context: { type: rec.subject_type, name: rec.subject_name, facts: `- ${rec.subject_name} (no longer active in AppFolio)` },
        related: [],
      } satisfies ResolvedSubject);

    const voices = rowVoices(rec);
    const speaker = voicesLabel(voices);
    let transcript: string;
    if (edit) {
      transcript = edit.transcript.trim();
      await setRow({
        transcript,
        transcript_original: rec.transcript_original ?? rec.transcript,
        transcript_edited_at: new Date().toISOString(),
        transcript_edited_by: edit.editedBy,
      });
    } else if (rec.transcript) {
      transcript = rec.transcript;
    } else {
      const { data: audio, error: dlErr } = await db.storage.from(BUCKET).download(rec.storage_path);
      if (dlErr || !audio) throw new Error(`Audio download failed: ${dlErr?.message ?? 'missing'}`);
      const result = await transcribeAudio(audio, rec.mime_type, subject.name);
      transcript = result.text;
      if (!transcript) throw new Error('Transcription came back empty — was the microphone muted?');
      await setRow({ transcript, transcript_model: TRANSCRIBE_MODEL, duration_sec: result.durationSec, size_bytes: audio.size });
    }

    const written = isTextEntry(rec);
    const notes = await distillNotes(subject.context, transcript, voices.map(voiceName), recordedOn(rec.created_at), written);
    const nodeId = await ensureGraph(db, subject);

    await deleteRecordingChunks(db, rec.id);
    const label = subject.type === 'owner' ? 'Owner' : 'Property';
    const header = `${label}: ${subject.name} — ${speaker}, ${written ? 'written' : 'recorded'} ${recordedOn(rec.created_at)}`;
    const common = {
      sourceTable: 'kc_recording',
      sourceId: rec.id,
      sourceUrl: `/knowledge-capture?${subject.type}=${encodeURIComponent(subject.id)}`,
      domain: 'company' as const,
      sensitivity: 'internal' as const,
      nodeId,
    };
    const windows = splitTranscript(transcript);
    const inputs = [
      ...windows.map((w, i) => ({
        ...common,
        content: `${header} — ${written ? 'note' : 'transcript'} part ${i + 1}/${windows.length}\n\n${w}`,
        kind: 'fact' as const,
        sourceKey: `kc:rec:${rec.id}:t${i}`,
        author: `human:${voices.join('+')}`,
      })),
      ...chunkMarkdown(notes, header).map((c) => ({
        ...common,
        content: c.content,
        kind: 'summary' as const,
        sourceKey: `kc:rec:${rec.id}:n${c.index}`,
        author: AUTHOR,
      })),
    ];
    // A few embeddings in flight at once keeps long takes inside the 300s limit.
    const actions = await pool(inputs, 6, (input) => ingestChunk(input, 'knowledge-capture'));
    const failed = actions.filter((a) => a === 'error').length;
    if (failed) throw new Error(`${failed} of ${inputs.length} brain entries failed to save (embedding service?). Retry.`);

    await setRow({ status: 'done', notes_md: notes, chunk_count: inputs.length });
    subjectRef = { type: subject.type, id: subject.id, resolved: subject };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[knowledge-capture] processing ${rec.id} failed:`, message);
    await setRow({ status: 'error', error: message.slice(0, 500) }).catch(() => undefined);
    throw err;
  }

  // The take is safely in the brain; a profile failure must not undo that.
  try {
    await regenerateProfile(subjectRef.type, subjectRef.id, subjectRef.resolved);
  } catch (err) {
    console.error(`[knowledge-capture] profile rebuild after ${rec.id} failed:`, err);
    await setRow({ error: 'Saved to the brain, but the profile did not update — use Rebuild profile.' }).catch(() => undefined);
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
  const ids = await subjectIds(db, type, id);
  const loadDone = async () => {
    const { data, error } = await db
      .from('kc_recording')
      .select('id, subject_name, speaker_email, speaker_name, voices, notes_md, created_at, updated_at')
      .eq('org_id', ORG)
      .eq('subject_type', type)
      .in('subject_id', ids)
      .eq('status', 'done')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  // Fingerprint of the takes a profile was built from: if another take
  // finished while we were synthesizing, build again so it isn't dropped.
  const fingerprint = (rows: { id: string; updated_at: string }[]) => rows.map((r) => `${r.id}@${r.updated_at}`).join('|');
  let recs = await loadDone();

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

  let profile = '';
  let used = withNotes;
  for (let attempt = 0; attempt < 3; attempt++) {
    const contributors = [...new Set(used.flatMap((r) => rowVoices(r)))].map(voiceName);
    profile = await synthesizeProfile(
      context,
      used.map((r) => ({
        speaker: voicesLabel(rowVoices(r)),
        recordedOn: recordedOn(r.created_at),
        notes: r.notes_md as string,
      })),
      contributors
    );
    recs = await loadDone();
    const now = recs.filter((r) => r.notes_md);
    if (fingerprint(now) === fingerprint(used)) break;
    if (!now.length) return null; // everything was deleted meanwhile
    used = now;
  }
  const withNotesFinal = used;

  // Edges were laid down when the recordings were processed.
  const nodeId = await upsertNode(db, { type, id, name }, profile);
  const label = type === 'owner' ? 'Owner' : 'Property';
  const profileAction = await ingestChunk(
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
  if (profileAction === 'error') throw new Error('The profile could not be saved to the brain');

  const { error: upErr } = await db.from('kc_profile').upsert(
    {
      org_id: ORG,
      subject_type: type,
      subject_id: id,
      subject_name: name,
      profile_md: profile,
      recording_count: withNotesFinal.length,
      model: SYNTH_MODEL,
      brain_node_id: nodeId,
      generated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,subject_type,subject_id' }
  );
  if (upErr) throw new Error(upErr.message);
  return profile;
}

/** Ids are interpolated into PostgREST or() filters below — plain ids only. */
function assertOwnerIds(...ids: string[]) {
  if (!ids.every((id) => /^[A-Za-z0-9-]{1,64}$/.test(id))) throw new Error('Invalid owner id');
}

async function hasProfile(db: SupabaseClient, ownerId: string): Promise<boolean> {
  const { data } = await db
    .from('kc_profile')
    .select('subject_id')
    .eq('org_id', ORG)
    .eq('subject_type', 'owner')
    .eq('subject_id', ownerId)
    .maybeSingle();
  return !!data;
}

/** Drop a profile row and its brain chunk (a duplicate that merged away). */
async function dropProfile(db: SupabaseClient, ownerId: string): Promise<void> {
  await db.from('kc_profile').delete().eq('org_id', ORG).eq('subject_type', 'owner').eq('subject_id', ownerId);
  await db.from('brain_chunk').delete().eq('org_id', ORG).eq('source_key', `kc:profile:owner:${ownerId}`);
}

async function ownerNode(db: SupabaseClient, raw: Roster, id: string): Promise<string> {
  const name = raw.owners.find((o) => o.id === id)?.name ?? `Owner ${id}`;
  return upsertNode(db, { type: 'owner', id, name });
}

async function setEdge(db: SupabaseClient, src: string, dst: string, relation: 'supersedes' | 'related_to') {
  const { error } = await db
    .from('brain_edge')
    .upsert({ src_node_id: src, dst_node_id: dst, relation }, { onConflict: 'src_node_id,dst_node_id,relation', ignoreDuplicates: true });
  if (error) console.error('[knowledge-capture] edge upsert failed:', error.message);
}

/**
 * Link two owner records. `keepId` is the profile being viewed; for 'same',
 * `otherId` (and anything already merged into it) folds into it. Replaces any
 * earlier decision about the pair.
 */
export async function linkOwners(
  keepId: string,
  otherId: string,
  kind: 'same' | 'related' | 'distinct',
  createdBy: string,
  note?: string | null
): Promise<void> {
  assertOwnerIds(keepId, otherId);
  const db = getSupabaseAdmin();
  const { raw, aliases } = await loadRoster(db);
  const known = new Set(raw.owners.map((o) => o.id));
  if (!known.has(keepId) || !known.has(otherId)) throw new Error('Both must be active AppFolio owners');
  const keep = canonicalOwner(aliases, keepId);
  const other = canonicalOwner(aliases, otherId);
  if (keep === other) throw new Error('These are already one profile');

  const { error: delErr } = await db
    .from('kc_owner_link')
    .delete()
    .eq('org_id', ORG)
    .or(`and(owner_id.eq.${keep},linked_owner_id.eq.${other}),and(owner_id.eq.${other},linked_owner_id.eq.${keep})`);
  if (delErr) throw new Error(delErr.message);

  if (kind === 'same') {
    // Duplicates already merged into `other` now point straight at `keep`.
    const { error: moveErr } = await db
      .from('kc_owner_link')
      .update({ linked_owner_id: keep })
      .eq('org_id', ORG)
      .eq('kind', 'same')
      .eq('linked_owner_id', other);
    if (moveErr) throw new Error(moveErr.message);
  }

  const { error } = await db.from('kc_owner_link').insert(
    kind === 'same'
      ? { org_id: ORG, owner_id: other, linked_owner_id: keep, kind, note: note ?? null, created_by: createdBy }
      : { org_id: ORG, owner_id: keep, linked_owner_id: other, kind, note: note ?? null, created_by: createdBy }
  );
  if (error) throw new Error(error.message);
  if (kind === 'distinct') return;

  const [keepNode, otherNode] = [await ownerNode(db, raw, keep), await ownerNode(db, raw, other)];
  // Whatever the pair was before (e.g. related → same), its old edges go.
  await clearEdges(db, keepNode, otherNode);
  if (kind === 'same') {
    await setEdge(db, keepNode, otherNode, 'supersedes');
    await dropProfile(db, other);
    await regenerateProfile('owner', keep);
    return;
  }
  await setEdge(db, keepNode, otherNode, 'related_to');
  await setEdge(db, otherNode, keepNode, 'related_to');
  // Profiles mention related owners; refresh the ones that exist.
  for (const id of [keep, other]) if (await hasProfile(db, id)) await regenerateProfile('owner', id);
}

async function clearEdges(db: SupabaseClient, a: string, b: string): Promise<void> {
  const { error } = await db
    .from('brain_edge')
    .delete()
    .or(`and(src_node_id.eq.${a},dst_node_id.eq.${b}),and(src_node_id.eq.${b},dst_node_id.eq.${a})`)
    .in('relation', ['supersedes', 'related_to']);
  if (error) console.error('[knowledge-capture] edge cleanup failed:', error.message);
}

/**
 * Remove whatever link joins two owner profiles and rebuild both. Matches
 * through merges: a 'related' link stored on a record that has since merged
 * still unlinks from the profile it merged into.
 */
export async function unlinkOwners(aId: string, bId: string): Promise<void> {
  assertOwnerIds(aId, bId);
  const db = getSupabaseAdmin();
  const { raw } = await loadRoster(db);
  const links = await loadOwnerLinks(db);
  const before = aliasMap(links);
  const ca = canonicalOwner(before, aId);
  const cb = canonicalOwner(before, bId);
  const targets = links.filter((l) => {
    const x = l.kind === 'same' ? l.owner_id : canonicalOwner(before, l.owner_id);
    const y = l.kind === 'same' ? l.linked_owner_id : canonicalOwner(before, l.linked_owner_id);
    // A merge is undone record-by-record (the duplicate the user clicked).
    if (l.kind === 'same') return (x === aId && y === bId) || (x === bId && y === aId) || (x === aId && y === cb) || (x === bId && y === ca);
    return (x === ca && y === cb) || (x === cb && y === ca);
  });
  if (!targets.length) throw new Error('Those owners are not linked');
  for (const l of targets) {
    assertOwnerIds(l.owner_id, l.linked_owner_id);
    const { error } = await db
      .from('kc_owner_link')
      .delete()
      .eq('org_id', ORG)
      .eq('owner_id', l.owner_id)
      .eq('linked_owner_id', l.linked_owner_id);
    if (error) throw new Error(error.message);
  }
  if (targets.every((l) => l.kind === 'distinct')) return;

  for (const l of targets) {
    await clearEdges(db, await ownerNode(db, raw, l.owner_id), await ownerNode(db, raw, l.linked_owner_id));
  }
  // Split profiles rebuild from their own recordings (or vanish if they have none).
  const after = aliasMap(await loadOwnerLinks(db));
  const ids = new Set([aId, bId, ...targets.flatMap((l) => [l.owner_id, l.linked_owner_id])].map((x) => canonicalOwner(after, x)));
  for (const id of ids) await regenerateProfile('owner', id);
}
