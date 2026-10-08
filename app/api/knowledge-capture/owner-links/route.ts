import { NextRequest, NextResponse } from 'next/server';
import { requireSection } from '@/lib/require-role';
import { linkOwners, unlinkOwners } from '@/lib/knowledge-capture/pipeline';

// Linking rebuilds up to two profiles (synthesis passes).
export const maxDuration = 300;

const KINDS = ['same', 'related', 'distinct'] as const;
type Kind = (typeof KINDS)[number];

// AppFolio ids are UUIDs; anything else is rejected before it reaches a
// PostgREST or() filter (lib/knowledge-capture/pipeline.ts linkOwners).
const ID = /^[A-Za-z0-9-]{1,64}$/;
const ids = (body: Record<string, unknown>) =>
  typeof body.ownerId === 'string' && ID.test(body.ownerId) && typeof body.otherId === 'string' && ID.test(body.otherId) && body.ownerId !== body.otherId
    ? { ownerId: body.ownerId, otherId: body.otherId }
    : null;

/**
 * POST /api/knowledge-capture/owner-links
 * Body: { ownerId (profile kept), otherId, kind: 'same'|'related'|'distinct', note? }
 */
export async function POST(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pair = ids(body);
  if (!pair) return NextResponse.json({ error: 'Pick two different owners' }, { status: 400 });
  if (!KINDS.includes(body.kind as Kind)) return NextResponse.json({ error: 'Unknown link type' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null;
  try {
    await linkOwners(pair.ownerId, pair.otherId, body.kind as Kind, guard.email, note);
  } catch (err) {
    console.error('[knowledge-capture] link failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Link failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/knowledge-capture/owner-links  Body: { ownerId, otherId } — undo a link. */
export async function DELETE(request: NextRequest) {
  const guard = await requireSection('knowledge_capture');
  if (!guard.ok) return guard.response;
  const pair = ids((await request.json().catch(() => ({}))) as Record<string, unknown>);
  if (!pair) return NextResponse.json({ error: 'Pick two different owners' }, { status: 400 });
  try {
    await unlinkOwners(pair.ownerId, pair.otherId);
  } catch (err) {
    console.error('[knowledge-capture] unlink failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unlink failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
