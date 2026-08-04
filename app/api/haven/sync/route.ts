import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { havenConfigured, syncHavenConversations } from '@/lib/haven';
import { matchConversationsToAppFolioLeads } from '@/lib/haven-af-match';

export const maxDuration = 300;

// Vercel Cron sends GET; expose both verbs.
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * POST /api/haven/sync
 *
 * Pull all Haven leasing conversations into haven_conversation, computing
 * response times from conversation histories for new/updated threads.
 * Auth: CRON_SECRET bearer OR @highdesertpm.com session.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      const session = await getServerSession(authOptions);
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (!havenConfigured()) {
      return NextResponse.json({ error: 'HAVEN_API_KEY is not set' }, { status: 503 });
    }

    const supabase = getSupabaseAdmin();
    const result = await syncHavenConversations(supabase);

    // AppFolio lead identity join — ?af_lookback=240 for the one-time backfill
    // (default 30d keeps the daily cron light). Failure here shouldn't fail
    // the conversation sync.
    const lookbackDays = Number(new URL(request.url).searchParams.get('af_lookback')) || 30;
    let afMatch = null;
    try {
      afMatch = await matchConversationsToAppFolioLeads(supabase, { lookbackDays });
    } catch (err) {
      console.error('[Haven Sync] AppFolio lead match failed:', err);
    }

    console.log(
      `[Haven Sync] ${result.conversations} conversations, ${result.historiesFetched} histories, ` +
        `${result.escalationsOpen} open escalations, ${result.pendingFollowUps} pending follow-ups, ` +
        `af match: ${afMatch ? `${afMatch.matched} new / ${afMatch.statusRefreshed} refreshed` : 'failed'}`
    );

    return NextResponse.json({ ...result, afMatch });
  } catch (error) {
    console.error('[Haven Sync] error:', error);
    const message = error instanceof Error ? error.message : 'Haven sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
