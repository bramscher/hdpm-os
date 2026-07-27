/**
 * Haven conversation ↔ AppFolio lead identity join.
 *
 * There is no shared id between the systems — the same prospect is an
 * AppFolio lead (guest card) and a Haven conversation, connected only by
 * email/phone. This matches them (normalized email first, then last-10-digit
 * phone) and stores the AppFolio lead id, web-app Link, PropertyId, and lead
 * status on haven_conversation. Also refreshes af_lead_status on rows already
 * matched, which is what conversion attribution reads
 * (active:converted_to_tenant etc.).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const V0_BASE = 'https://api.appfolio.com/api/v0';

interface V0LeadLite {
  Id: string;
  Email: string | null;
  PhoneNumber: string | null;
  PropertyId: string | null;
  Status: string;
  InactiveReason: string | null;
  Link?: string | null;
  CreatedAt: string;
  LastUpdatedAt: string;
}

function normEmail(e: string | null | undefined): string | null {
  const v = (e || '').trim().toLowerCase();
  return v.includes('@') ? v : null;
}

function normPhone(p: string | null | undefined): string | null {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

async function fetchLeads(lookbackDays: number): Promise<V0LeadLite[]> {
  const clientId = process.env.APPFOLIO_CLIENT_ID;
  const clientSecret = process.env.APPFOLIO_CLIENT_SECRET;
  const developerId = process.env.APPFOLIO_DEVELOPER_ID;
  if (!clientId || !clientSecret || !developerId) return [];

  const headers = {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'X-AppFolio-Developer-ID': developerId,
    Accept: 'application/json',
  };
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();

  const all: V0LeadLite[] = [];
  let url: string | null =
    `${V0_BASE}/leads?` +
    new URLSearchParams({
      'filters[LastUpdatedAtFrom]': since,
      'page[number]': '1',
      'page[size]': '100',
    }).toString();

  for (let page = 0; page < 120 && url; page++) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`AppFolio /leads ${res.status}`);
    const json = (await res.json()) as { data?: V0LeadLite[]; next_page_path?: string | null };
    all.push(...(json.data || []));
    url = json.next_page_path ? `https://api.appfolio.com${json.next_page_path}` : null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

export interface HavenAfMatchResult {
  candidates: number;
  matched: number;
  statusRefreshed: number;
  leadsScanned: number;
}

export async function matchConversationsToAppFolioLeads(
  supabase: SupabaseClient,
  { lookbackDays = 30 }: { lookbackDays?: number } = {}
): Promise<HavenAfMatchResult> {
  const leads = await fetchLeads(lookbackDays);
  if (leads.length === 0) return { candidates: 0, matched: 0, statusRefreshed: 0, leadsScanned: 0 };

  // Prefer the newest lead when the same email/phone inquired repeatedly.
  const sorted = [...leads].sort((a, b) => a.CreatedAt.localeCompare(b.CreatedAt));
  const byEmail = new Map<string, V0LeadLite>();
  const byPhone = new Map<string, V0LeadLite>();
  const byId = new Map<string, V0LeadLite>();
  for (const l of sorted) {
    const e = normEmail(l.Email);
    const p = normPhone(l.PhoneNumber);
    if (e) byEmail.set(e, l);
    if (p) byPhone.set(p, l);
    byId.set(l.Id, l);
  }

  const leadStatus = (l: V0LeadLite) =>
    l.InactiveReason ? `${l.Status}:${l.InactiveReason}` : l.Status;

  // Unmatched conversations → try to match.
  const rows: Array<{
    conversation_id: string;
    email: string | null;
    phone_number: string | null;
    appfolio_lead_id: string | null;
    af_lead_status: string | null;
  }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('haven_conversation')
      .select('conversation_id, email, phone_number, appfolio_lead_id, af_lead_status')
      .range(from, from + 999);
    if (error) throw new Error(`haven_conversation read failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const nowIso = new Date().toISOString();
  let matched = 0;
  let statusRefreshed = 0;
  const unmatched = rows.filter((r) => !r.appfolio_lead_id);

  for (const r of unmatched) {
    const lead =
      (normEmail(r.email) && byEmail.get(normEmail(r.email)!)) ||
      (normPhone(r.phone_number) && byPhone.get(normPhone(r.phone_number)!)) ||
      null;
    if (!lead) continue;
    const { error } = await supabase
      .from('haven_conversation')
      .update({
        appfolio_lead_id: lead.Id,
        appfolio_lead_link: lead.Link || null,
        appfolio_property_id: lead.PropertyId,
        af_lead_status: leadStatus(lead),
        af_matched_at: nowIso,
      })
      .eq('conversation_id', r.conversation_id);
    if (!error) matched++;
  }

  // Already-matched rows whose lead was updated in the window → refresh status
  // (this is how conversions flow back onto conversations).
  for (const r of rows) {
    if (!r.appfolio_lead_id) continue;
    const lead = byId.get(r.appfolio_lead_id);
    if (!lead) continue;
    const status = leadStatus(lead);
    if (status === r.af_lead_status) continue;
    const { error } = await supabase
      .from('haven_conversation')
      .update({ af_lead_status: status, appfolio_property_id: lead.PropertyId })
      .eq('conversation_id', r.conversation_id);
    if (!error) statusRefreshed++;
  }

  return {
    candidates: unmatched.length,
    matched,
    statusRefreshed,
    leadsScanned: leads.length,
  };
}
