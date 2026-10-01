import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { askRAG } from '@/lib/rag';
import { docsForChunks } from '@/lib/brain/viz-server';

export const maxDuration = 60;

/**
 * POST /api/brain/viz/ask { question } — answer with askRAG (same as Dez) and
 * return the snapshot doc keys of the cited sources so /brain can light them.
 * Gated like /api/brain/viz: staff session + the `brain` section, via the proxy.
 */
export async function POST(request: NextRequest) {
  if (!(await requireStaffOrService(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let question = '';
  try {
    question = String((await request.json())?.question ?? '').trim().slice(0, 1000);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!question) return NextResponse.json({ error: 'question is required' }, { status: 400 });
  try {
    const { answer, sources } = await askRAG(question);
    const docs = await docsForChunks(sources.map((s) => s.id));
    return NextResponse.json({ answer, sources: sources.map(({ id, title, url, type }) => ({ id, title, url, type })), docs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brain-viz] ask failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
