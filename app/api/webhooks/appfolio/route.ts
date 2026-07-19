import { NextRequest, NextResponse } from 'next/server';
import { verifyAppfolioSignature } from '@/lib/webhook-verify';
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
// Webhook Payload Type
// ============================================

// Real AppFolio webhook payload shape (verified from live events 2026-07-15).
// NOTE: the entity id is `resource_id`, NOT `entity_id`; topics are lowercase
// plural (e.g. "units", "work_orders", "bills", "journal_entries").
interface WebhookPayload {
  topic: string;
  event_id: string;
  client_id: string;
  event_type: string; // create | update | delete
  database_id: string;
  resource_id: string; // the id of the changed entity
  event_timestamp: string;
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
// inspection phase we log financial events to appfolio_webhook_log and fetch the
// full entity by Id, so we can see a real HDMS disbursement before writing
// capture logic. Topic strings are lowercase plural (e.g. "bills",
// "journal_entries", "general_ledger_details", "charges").

const FINANCIAL_TOPIC_RE = /bill|journal|ledger|charge|check|payment|disburs/i;

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
    const isValid = await verifyAppfolioSignature(rawBody, jwsSignature);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // 3. Parse the verified payload
    const payload: WebhookPayload = JSON.parse(rawBody.toString());
    const entityId = payload.resource_id;
    console.log(
      `[Webhook] Received: topic=${payload.topic} type=${payload.event_type} resource=${entityId} at=${payload.event_timestamp}`
    );

    // 4. Route by topic
    switch (payload.topic) {
      case 'work_orders':
      case 'work_order_updates': // legacy/alias
        await handleWorkOrderUpdate(entityId);
        break;

      default:
        // Inspection phase: log financial topics (bills / journal entries / GL /
        // charges) with the fetched entity; ignore the noisy rest (units, etc.).
        if (FINANCIAL_TOPIC_RE.test(payload.topic)) {
          await logWebhookEvent(payload.topic, entityId, payload);
        }
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
