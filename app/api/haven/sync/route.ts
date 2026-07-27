import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { havenConfigured, syncHavenConversations } from '@/lib/haven';

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
      const session = await getServerSession();
      if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    if (!havenConfigured()) {
      return NextResponse.json({ error: 'HAVEN_API_KEY is not set' }, { status: 503 });
    }

    const supabase = getSupabaseAdmin();
    const result = await syncHavenConversations(supabase);

    console.log(
      `[Haven Sync] ${result.conversations} conversations, ${result.historiesFetched} histories, ` +
        `${result.escalationsOpen} open escalations, ${result.pendingFollowUps} pending follow-ups`
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Haven Sync] error:', error);
    const message = error instanceof Error ? error.message : 'Haven sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
