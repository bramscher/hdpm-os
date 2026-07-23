/**
 * AppFolio Reports API v2 client (separate credential pair from the v0 API —
 * generated under General Settings → Manage API Settings → Reports API
 * Credentials). POST https://highdesertpm.appfolio.com/api/v2/reports/<name>.json
 * with HTTP Basic auth; responses are { results, next_page_url } pages of up
 * to 5,000 rows. next_page_url calls are not rate-limited; fresh report runs
 * are limited to 7 requests per 15s, so callers space them out.
 */

import { fetchAllUnitsPublic } from '@/lib/appfolio';

const REPORTS_BASE = 'https://highdesertpm.appfolio.com/api/v2/reports';

function getReportsAuth(): string | null {
  const id = process.env.APPFOLIO_REPORTS_CLIENT_ID;
  const secret = process.env.APPFOLIO_REPORTS_CLIENT_SECRET;
  if (!id || !secret) return null;
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

export function reportsApiConfigured(): boolean {
  return getReportsAuth() !== null;
}

interface ReportPage<T> {
  results?: T[];
  next_page_url?: string | null;
}

/**
 * Run a v2 report and collect every page. `filters` is the report's request
 * body (each report documents its own; many are optional). Throws on non-200.
 */
export async function runReport<T = Record<string, unknown>>(
  name: string,
  filters: Record<string, unknown> = {}
): Promise<T[]> {
  const auth = getReportsAuth();
  if (!auth) {
    throw new Error('AppFolio Reports API credentials not configured (APPFOLIO_REPORTS_CLIENT_ID/SECRET)');
  }
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const rows: T[] = [];
  let url = `${REPORTS_BASE}/${name}.json`;
  let body: string | undefined = JSON.stringify(filters);

  for (let page = 0; ; page++) {
    const res = await fetch(url, { method: 'POST', headers, body });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Reports API ${name} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const parsed = JSON.parse(text) as ReportPage<T> | T[];
    if (Array.isArray(parsed)) {
      // paginate_results=false shape — plain array.
      rows.push(...parsed);
      break;
    }
    rows.push(...(parsed.results ?? []));
    if (!parsed.next_page_url) break;
    // next_page_url references cached results: POST with no filters.
    url = parsed.next_page_url;
    body = undefined;
    if (page > 100) throw new Error(`Reports API ${name}: runaway pagination`);
  }
  return rows;
}

// ============================================
// Numeric-id bridge
// ============================================

export interface BridgedUnit {
  /** v0 API UUID — what our tables store in *_unit_id columns. */
  uuid: string;
  name: string | null;
}

/**
 * The Reports API identifies units by their numeric web-app id, while v0 (and
 * every table in this app) uses UUIDs. v0 units carry the web-app URL in
 * `Link` (…/properties/{n}/units/{numericId}); parse it to bridge the two.
 */
export async function fetchUnitIdBridge(): Promise<Map<string, BridgedUnit>> {
  const units = await fetchAllUnitsPublic();
  const map = new Map<string, BridgedUnit>();
  for (const u of units) {
    const m = /\/units\/(\d+)(?:[/?#]|$)/.exec(u.link ?? '');
    if (!m) continue;
    map.set(m[1], { uuid: u.id, name: u.name });
  }
  return map;
}
