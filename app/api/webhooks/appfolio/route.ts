import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import {
  fetchWorkOrderById,
  fetchPropertyById,
  fetchBillById,
  fetchJournalEntryById,
} from '@/lib/appfolio';
import {
  getWorkOrderByAppfolioId,
  upsertSingleWorkOrder,
} from '@/lib/work-orders';
import { getSupabaseAdmin } from '@/lib/supabase';

// ============================================
// AppFolio JWKS (cached remote key set)
// ============================================

const JWKS = jose.createRemoteJWKSet(
  new URL('https://api.appfolio.com/.well-known/jwks.json')
);

// ============================================
// JWS Signature Verification
// ============================================

/**
 * Verify the detached JWS signature from AppFolio.
 *
 * AppFolio sends X-JWS-Signature in detached payload format:
 *   BASE64URL(header)..BASE64URL(signature)
 *
 * We reconstruct the full compact JWS by base64url-encoding
 * the raw request body and inserting it between the two parts.
 *
 * Algorithm: RSASSA-PSS-SHA-256 (PS256)
 * JWKS: https://api.appfolio.com/.well-known/jwks.json
 */
async function verifySignature(
  rawBody: Buffer,
  jwsSignature: string
): Promise<boolean> {
  try {
    const [encodedHeader, encodedSignature] = jwsSignature.split('..');
    if (!encodedHeader || !encodedSignature) {
      console.error('[Webhook] Malformed X-JWS-Signature header');
      return false;
    }

    // Base64url-encode the raw body (unpadded, per RFC 4648)
    const encodedPayload = rawBody.toString('base64url').replaceAll('=', '');

    // Reconstruct the full compact JWS
    const message = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

    // Verify against AppFolio's public keys
    await jose.compactVerify(message, JWKS);
    return true;
  } catch (error) {
    console.error('[Webhook] Signature verification failed:', error);
    return false;
  }
}

// ============================================
// Webhook Payload Type
// ============================================

interface WebhookPayload {
  client_id: string;
  id: string;
  topic: string;
  entity_id: string;
  update_timestamp: string;
  message_sent_at: string;
}

// ============================================
// Work Order Update Handler
// ============================================

async function handleWorkOrderUpdate(entityId: string): Promise<void> {
  console.log(`[Webhook] Processing work_order_updates for entity ${entityId}`);

  // 1. Fetch the updated work order from AppFolio v0 API
  const wo = await fetchWorkOrderById(entityId);
  if (!wo) {
    console.warn(`[Webhook] Could not fetch work order ${entityId} from AppFolio`);
    return;
  }

  // 2. Resolve property name and address
  let propertyName = 'Unknown Property';
  let propertyAddress: string | null = null;

  // Check if we already have this work order (reuse existing property info)
  const existing = await getWorkOrderByAppfolioId(entityId);
  let unitName: string | null = null;
  if (existing) {
    propertyName = existing.property_name;
    propertyAddress = existing.property_address;
    // Preserve the unit name the full sync resolved — the webhook payload has
    // only UnitId, so re-deriving it here would null it out on every update.
    unitName = existing.unit_name;
  }

  // If it's a new work order or property was unknown, look up from AppFolio
  if (wo.propertyId && propertyName === 'Unknown Property') {
    const prop = await fetchPropertyById(wo.propertyId);
    if (prop) {
      propertyName = prop.name;
      propertyAddress = prop.address;
    }
  }

  // 3. Upsert into our work_orders table
  await upsertSingleWorkOrder(wo, propertyName, propertyAddress, unitName);

  console.log(
    `[Webhook] Work order ${entityId} synced: ${wo.appfolioStatus} — ${wo.description.substring(0, 60)}`
  );
}

// ============================================
// Webhook event inspection (everything except work orders)
// ============================================
//
// The lump ACH to HDMS posts to the GL as a journal entry; a webhook is the
// only way to read one (the v0 API can't list journal entries). During this
// inspection phase we log EVERY non-work-order event to appfolio_webhook_log so
// nothing is missed — including test events and whatever exact topic strings
// AppFolio uses — and fetch the full entity by Id for the financial ones.

async function logWebhookEvent(
  topic: string,
  entityId: string,
  rawPayload: WebhookPayload
): Promise<void> {
  let entity: Record<string, unknown> | null = null;
  let fetchError: string | null = null;

  try {
    if (/journal|ledger/i.test(topic)) {
      entity = await fetchJournalEntryById(entityId);
    } else if (/bill/i.test(topic)) {
      entity = await fetchBillById(entityId);
    }
    // Other topics (charges/checks/test/etc): log the payload; no fetcher yet.
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  console.log(
    `[Webhook] Logged topic=${topic} entity=${entityId} fetched=${!!entity}` +
      (fetchError ? ` error=${fetchError}` : '')
  );

  try {
    await getSupabaseAdmin()
      .from('appfolio_webhook_log')
      .insert({ topic, entity_id: entityId, raw_payload: rawPayload, entity, fetch_error: fetchError });
  } catch (err) {
    console.error('[Webhook] Failed to persist webhook log:', err);
  }
}

// ============================================
// POST /api/webhooks/appfolio
// ============================================

export async function POST(request: NextRequest) {
  try {
    // 1. Get raw body for signature verification
    const rawBody = Buffer.from(await request.arrayBuffer());
    const jwsSignature = request.headers.get('x-jws-signature');

    if (!jwsSignature) {
      console.error('[Webhook] Missing X-JWS-Signature header');
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }

    // 2. Verify JWS signature against AppFolio public keys
    const isValid = await verifySignature(rawBody, jwsSignature);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // 3. Parse the verified payload
    const payload: WebhookPayload = JSON.parse(rawBody.toString());
    console.log(
      `[Webhook] Received: topic=${payload.topic} entity=${payload.entity_id} updated=${payload.update_timestamp}`
    );

    // 4. Route by topic
    switch (payload.topic) {
      case 'work_order_updates':
        await handleWorkOrderUpdate(payload.entity_id);
        break;

      default:
        // Inspection phase: capture every other event so nothing slips through.
        await logWebhookEvent(payload.topic, payload.entity_id, payload);
    }

    // 5. Respond 200 to acknowledge receipt
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    // Still return 200 to prevent AppFolio from retrying endlessly
    // (log the error for investigation)
    return NextResponse.json({ received: true, error: 'processing_error' });
  }
}

// ============================================
// GET /api/webhooks/appfolio — health check
// ============================================

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/appfolio',
    topics: ['work_order_updates', 'bills / journal entries / GL / charges (inspection log)'],
    message: 'AppFolio webhook receiver is active',
  });
}
