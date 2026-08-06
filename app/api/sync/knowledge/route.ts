import { NextRequest, NextResponse } from 'next/server';
import { syncOrs90, syncNotionSops } from '@/lib/knowledge-sync';
import { syncOneDriveDocs } from '@/lib/onedrive-sync';

// Weekly refresh does ~160 statute fetches + embeddings — needs the long budget.
export const maxDuration = 300;

// Vercel Cron sends GET, so we expose both verbs; GET delegates to POST.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/sync/knowledge
 *
 * Weekly refresh of the HDPM Knowledge Chat corpus:
 *   - ORS Chapter 90 from oregon.public.law (statute text changes rarely, but
 *     this keeps it current without anyone re-running the ingest script)
 *   - Notion SOPs from the Process Documentation Hub (needs NOTION_API_KEY)
 *   - OneDrive/SharePoint docs from the team library (needs the app-only
 *     Graph creds with Files.Read.All; capped per run, eTag-incremental)
 *
 * Query params: ?target=ors | notion | onedrive | all (default all)
 * Protected by CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const target = new URL(request.url).searchParams.get('target') || 'all';
    const out: Record<string, unknown> = {};

    if (target === 'ors' || target === 'all') {
      out.ors_90 = await syncOrs90();
    }
    if (target === 'notion' || target === 'all') {
      out.notion_sops = await syncNotionSops();
    }
    if (target === 'onedrive' || target === 'all') {
      out.onedrive_docs = await syncOneDriveDocs();
    }

    console.log('[Sync] Knowledge refresh:', JSON.stringify(out));
    return NextResponse.json({ message: 'Knowledge sync complete', ...out });
  } catch (error) {
    console.error('[Sync] Knowledge sync error:', error);
    const message = error instanceof Error ? error.message : 'Knowledge sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
