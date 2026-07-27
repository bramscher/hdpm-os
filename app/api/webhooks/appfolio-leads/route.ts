import { NextRequest, NextResponse } from 'next/server';
import { verifyAppfolioSignature } from '@/lib/webhook-verify';
import { handleLeadUpdate } from '@/lib/lead-webhook';

// ============================================
// Webhook Payload Type — real deliveries use resource_id + lowercase-plural
// topics ('leads'); entity_id/lead_updates kept for the legacy shape.
// ============================================

interface WebhookPayload {
  client_id: string;
  id: string;
  topic: string;
  resource_id?: string;
  entity_id?: string;
  update_timestamp?: string;
  message_sent_at?: string;
}

// ============================================
// POST /api/webhooks/appfolio-leads
//
// NOTE: AppFolio's webhook config uses ONE listener URL for all topics —
// /api/webhooks/appfolio — which also dispatches 'leads'. This route stays
// as an alternate/manual endpoint with the same behavior.
// ============================================

export async function POST(request: NextRequest) {
  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    const jwsSignature = request.headers.get('x-jws-signature');

    if (!jwsSignature) {
      console.error('[Leads Webhook] Missing X-JWS-Signature header');
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }

    const isValid = await verifyAppfolioSignature(rawBody, jwsSignature);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload: WebhookPayload = JSON.parse(rawBody.toString());
    const entityId = payload.resource_id || payload.entity_id;
    console.log(`[Leads Webhook] Received: topic=${payload.topic} entity=${entityId}`);

    if ((payload.topic === 'leads' || payload.topic === 'lead_updates') && entityId) {
      await handleLeadUpdate(entityId);
    } else {
      console.log(`[Leads Webhook] Ignoring topic: ${payload.topic}`);
    }

    // Always return 200 to prevent AppFolio retries
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Leads Webhook] Error:', error);
    return NextResponse.json({ received: true, error: 'processing_error' });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/appfolio-leads',
    topics: ['leads', 'lead_updates'],
    message: 'AppFolio leads webhook receiver is active',
  });
}
