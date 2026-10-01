/**
 * withCronRun — records every scheduled cron invocation in routine_run.
 *
 *   async function handleGET(request: NextRequest) { ...existing handler... }
 *   export const GET = withCronRun(handleGET);
 *
 * The wrapper observes; it never changes what a route does or who may call it.
 * Each route keeps its own auth (several also accept a staff session for
 * "Sync now" buttons). Only requests carrying the CRON_SECRET bearer, checked
 * with timingSafeEqual, are logged, so manual runs don't pollute the calendar.
 *
 * Every database write is best-effort: if routine_run is missing (migration
 * not applied) or Supabase is down, the cron still runs and returns exactly
 * what it would have without the wrapper.
 */

import { timingSafeEqual } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase';
import { routineForUrl } from '@/lib/routines/registry';

export type RunStatus = 'ok' | 'halted' | 'skipped' | 'error';

export interface RunOutcome {
  status: RunStatus;
  halt_reason: string | null;
  items: number | null;
  recipients: string[];
  error: string | null;
}

/** True when the request carries the Vercel cron bearer. Constant-time. */
export function isCronRequest(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

const reasonText = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (v === true) return 'yes';
  return null;
};

const ITEM_KEYS = ['items', 'processed', 'count', 'total', 'synced', 'created', 'sent', 'scanned', 'upserted'];

/**
 * Sort a route's JSON response into a run status. This is what makes silent
 * L0 no-ops visible: `{ halted: 'kill switch' }` with a 200 is a halt, and
 * `{ skipped }` / `{ disabled: '…' }` are skips, not successes.
 */
export function classifyRun(httpStatus: number, body: unknown): RunOutcome {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const out: RunOutcome = { status: 'ok', halt_reason: null, items: null, recipients: [], error: null };

  for (const k of ITEM_KEYS) {
    if (typeof b[k] === 'number' && Number.isFinite(b[k])) {
      out.items = b[k] as number;
      break;
    }
  }
  if (Array.isArray(b.recipients)) out.recipients = b.recipients.filter((r): r is string => typeof r === 'string');

  const err = reasonText(b.error);
  if (httpStatus >= 400 || err || b.ok === false) {
    out.status = 'error';
    out.error = err ?? (httpStatus >= 400 ? `HTTP ${httpStatus}` : 'ok: false');
    return out;
  }
  const halted = reasonText(b.halted) ?? reasonText(b.halt_reason);
  if (halted) {
    out.status = 'halted';
    out.halt_reason = halted;
    return out;
  }
  const skipped = reasonText(b.skipped) ?? reasonText(b.disabled);
  if (skipped) {
    out.status = 'skipped';
    out.halt_reason = skipped;
  }
  return out;
}

/** Keep the stored summary small: top-level scalars and short arrays only. */
export function summarize(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
    } else if (Array.isArray(v)) {
      out[k] = v.length <= 10 && v.every((x) => typeof x !== 'object') ? v : `[${v.length} items]`;
    } else {
      out[k] = '{…}';
    }
    if (Object.keys(out).length >= 40) break;
  }
  return out;
}

async function startRun(routineId: string, path: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('routine_run')
      .insert({ routine_id: routineId, path })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  } catch (e) {
    console.warn(`[Cron] routine_run start not recorded (${routineId}):`, (e as Error).message);
    return null;
  }
}

async function finishRun(id: string, outcome: RunOutcome, summary: Record<string, unknown>) {
  try {
    const { error } = await getSupabaseAdmin()
      .from('routine_run')
      .update({ ...outcome, summary, finished_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn('[Cron] routine_run finish not recorded:', (e as Error).message);
  }
}

export function withCronRun<Req extends Request, Ctx extends unknown[]>(
  handler: (request: Req, ...ctx: Ctx) => Promise<Response>
): (request: Req, ...ctx: Ctx) => Promise<Response> {
  return async (request: Req, ...ctx: Ctx) => {
    if (!isCronRequest(request)) return handler(request, ...ctx);
    const url = new URL(request.url);
    const routine = routineForUrl(url);
    const routineId = routine?.id ?? `unregistered:${url.pathname}`;
    const runId = await startRun(routineId, url.pathname + url.search);

    let response: Response;
    try {
      response = await handler(request, ...ctx);
    } catch (e) {
      if (runId) {
        await finishRun(runId, { status: 'error', halt_reason: null, items: null, recipients: [], error: (e as Error).message ?? String(e) }, {});
      }
      throw e;
    }
    if (!runId) return response;

    let body: unknown = null;
    try {
      body = await response.clone().json();
    } catch {
      // Non-JSON response: classify on status code alone.
    }
    await finishRun(runId, classifyRun(response.status, body), summarize(body));
    return response;
  };
}
