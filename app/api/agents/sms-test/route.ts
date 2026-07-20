import { NextRequest, NextResponse } from 'next/server';
import { requireStaffOrService } from '@/lib/maintenance/api-auth';
import { getAdapter } from '@/lib/agents/channels';
import { isZoomSmsConfigured } from '@/lib/zoom-phone';
import type { OutboxMessage } from '@/lib/agents/types';

export const maxDuration = 60;

/**
 * POST /api/agents/sms-test — the Brief D.5 Step-0 probe.
 *
 * Body: {to: "+1..."} (E.164). Sends one fixed test message through the real
 * sms_zoom adapter path (no outbox row — nothing to clean up) and returns
 * the raw outcome. This settles per-tenant whether Zoom's POST
 * /phone/sms/messages works from our Server-to-Server app with the
 * configured sender (2025 devforum threads reported S2S scope and
 * on-behalf-of limitations; Zoom has since shipped account-level SMS APIs).
 *
 * Run from the browser console on hdpmchat (uses your staff session):
 *   fetch('/api/agents/sms-test', {method:'POST',
 *     headers:{'Content-Type':'application/json'},
 *     body: JSON.stringify({to:'+15415550100'})
 *   }).then(r=>r.json()).then(console.log)
 */
export async function POST(request: NextRequest) {
  const caller = await requireStaffOrService(request);
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!/^\+\d{11,15}$/.test(to)) {
      return NextResponse.json(
        { error: 'Body must be {to: "+1XXXXXXXXXX"} in E.164' },
        { status: 400 }
      );
    }

    const msg: Pick<
      OutboxMessage,
      'recipient_address' | 'body' | 'payload' | 'subject' | 'channel'
    > = {
      channel: 'sms_zoom',
      recipient_address: to,
      subject: null,
      body: 'HDPM-OS test: the Zoom SMS path works. No action needed.',
      payload: {},
    };
    const outcome = await getAdapter('sms_zoom').send(msg as OutboxMessage);
    return NextResponse.json({
      configured: isZoomSmsConfigured(),
      dryRun: process.env.AGENT_ZOOM_SMS_DRYRUN === '1',
      outcome,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agents] sms test failed:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
