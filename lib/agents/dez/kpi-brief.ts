/**
 * Dez kpi-brief skill — answer KPI questions in Slack from kpi_snapshots.
 *
 * The KPI layer (18 metrics, refreshed daily by /api/kpi/cron) already lives in
 * kpi_snapshots; this makes it reachable from a Slack question. Intent is a
 * cheap keyword match (no LLM routing call), precision-biased so it never
 * hijacks an SOP question; the answer is one claude-sonnet-5 call over the
 * matched snapshot JSON (handles the heterogeneous per-KPI shapes).
 *
 * Access: operational KPIs answer for everyone; financial KPIs only for the
 * admin allowlist (DEZ_KPI_ADMINS, default Craig/Matt/Penny) — mirroring the
 * admin-only web dashboard.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase';

interface KpiDef {
  label: string;
  synonyms: string[]; // lowercase; matched as word-ish substrings
  sensitive: boolean; // financial → admin-only
  ambiguous?: boolean; // synonyms overlap SOP language → require a metric signal
}

/** The 18 KPIs (names match app/api/kpi/cached/route.ts). */
export const KPI_CATALOG: Record<string, KpiDef> = {
  occupancy: { label: 'Occupancy', synonyms: ['occupancy', 'occupied'], sensitive: false },
  vacancy: { label: 'Vacancy', synonyms: ['vacancy', 'vacant', 'vacancies'], sensitive: false },
  work_orders: { label: 'Work orders', synonyms: ['work order', 'work orders', 'wo open', 'open wo', 'days to close', 'maintenance tickets'], sensitive: false },
  work_orders_completed: { label: 'Work orders completed', synonyms: ['work orders completed', 'completed work orders', 'wos completed'], sensitive: false },
  days_to_lease: { label: 'Days to lease', synonyms: ['days to lease', 'time to lease', 'days on market', 'how long to lease'], sensitive: false },
  guest_cards: { label: 'Guest cards', synonyms: ['guest card', 'guest cards', 'leads'], sensitive: false },
  leasing_funnel: { label: 'Leasing funnel', synonyms: ['leasing funnel', 'funnel'], sensitive: false },
  lease_renewal: { label: 'Lease renewals', synonyms: ['renewal', 'renewals', 'lease renewal'], sensitive: false, ambiguous: true },
  lease_expirations: { label: 'Lease expirations', synonyms: ['expiration', 'expirations', 'leases expiring', 'lease expirations'], sensitive: false, ambiguous: true },
  notices: { label: 'Notices', synonyms: ['notice', 'notices'], sensitive: false, ambiguous: true },
  insurance: { label: 'Renter insurance compliance', synonyms: ['insurance', 'renter insurance', 'renters insurance'], sensitive: false, ambiguous: true },
  bend_growth: { label: 'Bend growth', synonyms: ['bend growth', 'growth in bend', 'door growth'], sensitive: false },
  net_doors: { label: 'Net doors', synonyms: ['net doors', 'door count', 'total doors', 'units under management'], sensitive: true },
  delinquency: { label: 'Delinquency', synonyms: ['delinquency', 'delinquent', 'behind on rent', 'past due rent', 'collections'], sensitive: true },
  owner_retention: { label: 'Owner retention', synonyms: ['owner retention', 'owner churn', 'owners lost', 'cancellations'], sensitive: true },
  maintenance_cost: { label: 'Maintenance cost ratio', synonyms: ['maintenance cost', 'maintenance spend', 'maintenance ratio'], sensitive: true },
  maintenance_economics: { label: 'Maintenance economics', synonyms: ['maintenance economics', 'in-house maintenance', 'maintenance margin', 'markup'], sensitive: true },
  management_fees: { label: 'Management fees', synonyms: ['management fee', 'management fees', 'mgmt fee', 'mgmt fees', 'management revenue'], sensitive: true },
};

// Words that signal a metric question (used to disambiguate SOP-ish synonyms).
const METRIC_SIGNALS = [
  'how many', 'how much', 'number of', 'count', 'rate', 'current', 'currently',
  'this week', 'right now', 'trend', 'trending', 'percent', '%', "what's our", 'what is our',
  'average', 'avg', 'total', 'this month', 'last week', 'ytd',
];

const DEFAULT_ADMINS = ['Craig', 'Matt', 'Penny'];

/** Admin allowlist for financial KPIs (env DEZ_KPI_ADMINS, comma-separated). */
export function kpiAdmins(): string[] {
  const raw = process.env.DEZ_KPI_ADMINS;
  if (!raw) return DEFAULT_ADMINS;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Detect which KPI(s) a question is asking about. Precision-biased: ambiguous
 * synonyms (notice/insurance/renewal/expiration) only match when a metric
 * signal is also present, so SOP questions ("what notice do I give…") fall
 * through to askRAG. Pure.
 */
export function matchKpiIntent(question: string): string[] {
  const q = ` ${question.toLowerCase()} `;
  const hasSignal = METRIC_SIGNALS.some((s) => q.includes(s));
  const matched: string[] = [];
  for (const [name, def] of Object.entries(KPI_CATALOG)) {
    const hit = def.synonyms.some((syn) => q.includes(syn));
    if (!hit) continue;
    if (def.ambiguous && !hasSignal) continue; // needs a metric signal to count
    matched.push(name);
  }
  return matched;
}

/** Split matched KPIs into what this asker may see. Pure. */
export function partitionByAccess(
  names: string[],
  isAdmin: boolean
): { allowed: string[]; restricted: string[] } {
  const allowed: string[] = [];
  const restricted: string[] = [];
  for (const name of names) {
    const def = KPI_CATALOG[name];
    if (def && def.sensitive && !isAdmin) restricted.push(name);
    else allowed.push(name);
  }
  return { allowed, restricted };
}

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY or CLAUDE_API_KEY not set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

interface Snapshot {
  value: Record<string, unknown>;
  capturedAt: string;
  priorValue?: Record<string, unknown>;
  priorCapturedAt?: string;
}

/** Latest snapshot for a KPI + the closest one ~7 days earlier (for a delta). */
async function fetchSnapshot(name: string): Promise<Snapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data: latest } = await supabase
    .from('kpi_snapshots')
    .select('value, captured_at')
    .eq('kpi_name', name)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return null;

  const weekAgoIso = new Date(new Date(latest.captured_at as string).getTime() - 7 * 864e5).toISOString();
  const { data: prior } = await supabase
    .from('kpi_snapshots')
    .select('value, captured_at')
    .eq('kpi_name', name)
    .lte('captured_at', weekAgoIso)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    value: latest.value as Record<string, unknown>,
    capturedAt: latest.captured_at as string,
    priorValue: (prior?.value as Record<string, unknown>) ?? undefined,
    priorCapturedAt: (prior?.captured_at as string) ?? undefined,
  };
}

export interface KpiAnswer {
  answer: string;
  kpis: string[]; // KPI names actually answered
}

/**
 * Answer a KPI question from snapshot data. Gates financial KPIs; composes a
 * concise reply with one Claude call over the matched snapshots.
 */
export async function answerKpiQuestion(input: {
  question: string;
  names: string[];
  isAdmin: boolean;
}): Promise<KpiAnswer> {
  const { allowed, restricted } = partitionByAccess(input.names, input.isAdmin);

  if (allowed.length === 0) {
    return {
      answer:
        "That KPI is limited to management — I can't share financial figures here. Ask Craig, Matt, or Penny, or check the dashboard.",
      kpis: [],
    };
  }

  const snapshots: Record<string, Snapshot> = {};
  const missing: string[] = [];
  await Promise.all(
    allowed.map(async (name) => {
      const s = await fetchSnapshot(name);
      if (s) snapshots[name] = s;
      else missing.push(name);
    })
  );

  const haveNames = Object.keys(snapshots);
  if (haveNames.length === 0) {
    const labels = missing.map((n) => KPI_CATALOG[n]?.label ?? n).join(', ');
    return { answer: `I don't have a recent reading for ${labels} yet.`, kpis: [] };
  }

  const context = haveNames
    .map((name) => {
      const s = snapshots[name];
      return JSON.stringify(
        {
          kpi: name,
          label: KPI_CATALOG[name].label,
          latest: { value: s.value, capturedAt: s.capturedAt },
          ...(s.priorValue ? { about_a_week_ago: { value: s.priorValue, capturedAt: s.priorCapturedAt } } : {}),
        },
        null,
        1
      );
    })
    .join('\n\n');

  const restrictedNote = restricted.length
    ? ` (Note: I left out ${restricted.map((n) => KPI_CATALOG[n]?.label ?? n).join(', ')} — management-only.)`
    : '';
  const missingNote = missing.length
    ? ` (No recent reading for ${missing.map((n) => KPI_CATALOG[n]?.label ?? n).join(', ')}.)`
    : '';

  const system =
    'You are Dez, HDPM\'s internal ops assistant, answering a staff question about a KPI from snapshot ' +
    'data. Answer in 1-3 short sentences. Lead with the number and state its date ("as of <date>"). If ' +
    'an about-a-week-ago value is present, mention the week-over-week move. Use only the numbers given — ' +
    'never invent or estimate. Plain language; this posts to Slack.';

  const message = await getAnthropic().messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 600,
    system,
    messages: [
      {
        role: 'user',
        content: `Question: ${input.question}\n\nKPI snapshot data (JSON):\n${context}`,
      },
    ],
  });

  const composed = message.content[0]?.type === 'text' ? message.content[0].text.trim() : 'Unable to read that KPI.';
  return { answer: `${composed}${restrictedNote}${missingNote}`, kpis: haveNames };
}
