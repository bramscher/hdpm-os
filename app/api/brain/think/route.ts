import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { think } from '@/lib/brain/think';

export const maxDuration = 60;

/**
 * POST /api/brain/think — brain-only synthesis for agents (Brief 1D):
 * retrieval → cited answer → explicit "What I don't know" gap section.
 * Auth: service token (scope 'agents') + X-Agent-Actor, or staff session.
 * Sensitivity is clamped to 'internal' (as /api/brain/search).
 *
 * Body: { question: string, limit?: number, maxTokens?: number }
 */
export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { question?: unknown; limit?: unknown; maxTokens?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json({ error: 'question (string) is required' }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 20);
  const maxTokens = Math.min(Math.max(Number(body.maxTokens) || 1024, 256), 4096);

  try {
    const result = await think(question, { limit, maxTokens, maxSensitivity: 'internal' });
    return NextResponse.json({ ...result, caller: caller.actor });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brain] think API failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
