// ============================================
// In-house vs vendor work-order analysis
// ============================================
// Answers "what work should HDMS do in-house vs. leave to outside vendors?"
// Joins AppFolio bill_detail (cost per WO per payee) to the work_orders mirror
// (cycle time, description) and buckets WOs into trade categories, since the
// AppFolio WO payload carries no category. Read-only — AppFolio stays the
// system of record.
//
// Admin-only: this exposes vendor spend and margin strategy.

import { runReport } from '@/lib/appfolio-reports';
import { getSupabaseAdmin } from '@/lib/supabase';

/** Jobs at or under this are "handyman-scale" — capturable by an in-house tech. */
export const SMALL_JOB_MAX = 500;

/** Trades where licensing/insurance usually keeps the work outside. */
const LICENSED_TRADES = new Set(['Plumbing', 'HVAC', 'Electrical', 'Roofing', 'Pest Control']);

interface BillLine {
  work_order: string | null;
  payee_name: string | null;
  paid: string | number | null;
  unpaid: string | number | null;
  account_number: string | null;
  account_name: string | null;
}

interface WoRow {
  wo_number: string;
  vendor_name: string | null;
  description: string | null;
  appfolio_created_at: string | null;
  completed_date: string | null;
}

export interface CategorySplit {
  count: number;
  spend: number;
  avgCost: number;
  avgCycleDays: number | null; // null when no completed WOs to measure
}

export interface CategoryAnalysis {
  category: string;
  licensedTrade: boolean;
  hdms: CategorySplit;
  external: CategorySplit;
  /** External spend on jobs ≤ SMALL_JOB_MAX — the capturable opportunity. */
  smallJobOpportunity: number;
  smallJobCount: number;
  /** Top external payees in this category by spend. */
  topVendors: Array<{ name: string; spend: number; count: number }>;
}

export interface InhouseAnalysis {
  from: string;
  to: string;
  woCount: number;
  hdmsSpend: number;
  externalSpend: number;
  hdmsAvgCycleDays: number | null;
  externalAvgCycleDays: number | null;
  smallJobOpportunityTotal: number;
  categories: CategoryAnalysis[];
  unjoinedBillLines: number;
}

const money = (v: string | number | null | undefined) =>
  parseFloat(String(v ?? '0').replace(/,/g, '')) || 0;

const isHdms = (payee: string | null | undefined) =>
  (payee || '').toLowerCase().includes('high desert maintenance');

// ── Trade classification ─────────────────────────────────────────────
// GL account first (unambiguous), then description keywords, first match wins.

const KEYWORD_RULES: Array<[string, RegExp]> = [
  ['Appliance', /appliance|refrigerator|fridge|dishwasher|washer|dryer|stove|oven|microwave|range hood|garbage disposal/i],
  ['Plumbing', /plumb|leak|faucet|toilet|drain|water heater|pipe|sewer|sump|shower valve|hose bib/i],
  ['HVAC', /hvac|furnace|a\/c|air condition|thermostat|mini.?split|heat pump|ductless|heater(?! hose)/i],
  ['Electrical', /electric|outlet|breaker|gfci|wiring|ceiling fan|smoke detector|light fixture/i],
  ['Roofing', /roof|gutter|downspout/i],
  ['Flooring', /floor|carpet|vinyl|lvp|linoleum|tile(?! grout cleaning)/i],
  ['Landscaping', /landscap|lawn|mow|yard|sprinkler|irrigation|tree|shrub|weed|snow removal/i],
  ['Cleaning', /clean|housekeep|janitorial|haul|junk removal/i],
  ['Locks & Keys', /\block\b|rekey|re-key|deadbolt|\bkeys?\b/i],
  ['Painting', /paint|touch.?up walls/i],
  ['Drywall', /drywall|sheetrock|texture|patch wall/i],
  ['Pest Control', /pest|rodent|mice|\brats?\b|wasp|hornet|\bants?\b|bed bug/i],
  ['Doors & Windows', /\bdoor\b|window|screen|blinds|slider/i],
  ['Fencing & Decks', /fence|gate|deck|railing/i],
];

const GL_CATEGORY: Array<[RegExp, string]> = [
  [/landscap|grounds/i, 'Landscaping'],
  [/cleaning/i, 'Cleaning'],
  [/keys|locks/i, 'Locks & Keys'],
  [/pest/i, 'Pest Control'],
];

export function classifyWo(description: string | null, accountName: string | null): string {
  for (const [re, cat] of GL_CATEGORY) {
    if (accountName && re.test(accountName)) return cat;
  }
  const desc = description || '';
  for (const [cat, re] of KEYWORD_RULES) {
    if (re.test(desc)) return cat;
  }
  return 'General Repair';
}

// ── Analysis ─────────────────────────────────────────────────────────

export async function buildInhouseAnalysis(from: string, to: string): Promise<InhouseAnalysis> {
  const supabase = getSupabaseAdmin();

  const bills = await runReport<BillLine>('bill_detail', {
    occurred_on_from: from,
    occurred_on_to: to,
    columns: ['work_order', 'payee_name', 'paid', 'unpaid', 'account_number', 'account_name'],
  });
  // Maintenance GL only (6xxx) — keeps utilities/management fees out.
  const maint = bills.filter((b) => String(b.account_number || '').startsWith('6'));

  // One aggregate per WO: total cost, payee, GL hint.
  interface WoAgg {
    cost: number;
    hdms: boolean;
    payee: string;
    accountName: string | null;
  }
  const perWo = new Map<string, WoAgg>();
  let unjoined = 0;
  for (const b of maint) {
    const wo = (b.work_order || '').trim();
    if (!wo) {
      unjoined++;
      continue;
    }
    const agg = perWo.get(wo) || {
      cost: 0,
      hdms: isHdms(b.payee_name),
      payee: b.payee_name || '(unknown)',
      accountName: b.account_name,
    };
    agg.cost += money(b.paid) + money(b.unpaid);
    perWo.set(wo, agg);
  }

  // Join to the WO mirror for description + cycle time.
  const woKeys = [...perWo.keys()];
  const woRows = new Map<string, WoRow>();
  for (let i = 0; i < woKeys.length; i += 400) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('wo_number, vendor_name, description, appfolio_created_at, completed_date')
      .in('wo_number', woKeys.slice(i, i + 400));
    if (error) throw new Error(`work_orders join failed: ${error.message}`);
    for (const w of (data || []) as WoRow[]) woRows.set(w.wo_number, w);
  }

  interface Acc {
    hdms: { count: number; spend: number; cycleSum: number; cycleN: number };
    external: { count: number; spend: number; cycleSum: number; cycleN: number };
    smallJobOpportunity: number;
    smallJobCount: number;
    vendors: Map<string, { spend: number; count: number }>;
  }
  const cats = new Map<string, Acc>();
  const totals = {
    hdmsSpend: 0,
    externalSpend: 0,
    hdmsCycleSum: 0,
    hdmsCycleN: 0,
    extCycleSum: 0,
    extCycleN: 0,
  };

  for (const [woNum, agg] of perWo) {
    const wo = woRows.get(woNum);
    const category = classifyWo(wo?.description ?? null, agg.accountName);
    const acc: Acc = cats.get(category) || {
      hdms: { count: 0, spend: 0, cycleSum: 0, cycleN: 0 },
      external: { count: 0, spend: 0, cycleSum: 0, cycleN: 0 },
      smallJobOpportunity: 0,
      smallJobCount: 0,
      vendors: new Map(),
    };

    let cycleDays: number | null = null;
    if (wo?.appfolio_created_at && wo?.completed_date) {
      const d =
        (new Date(wo.completed_date).getTime() - new Date(wo.appfolio_created_at).getTime()) /
        86400000;
      if (d >= 0 && d <= 365) cycleDays = d;
    }

    const side = agg.hdms ? acc.hdms : acc.external;
    side.count++;
    side.spend += agg.cost;
    if (cycleDays != null) {
      side.cycleSum += cycleDays;
      side.cycleN++;
    }

    if (agg.hdms) {
      totals.hdmsSpend += agg.cost;
      if (cycleDays != null) {
        totals.hdmsCycleSum += cycleDays;
        totals.hdmsCycleN++;
      }
    } else {
      totals.externalSpend += agg.cost;
      if (cycleDays != null) {
        totals.extCycleSum += cycleDays;
        totals.extCycleN++;
      }
      if (agg.cost > 0 && agg.cost <= SMALL_JOB_MAX) {
        acc.smallJobOpportunity += agg.cost;
        acc.smallJobCount++;
      }
      const v = acc.vendors.get(agg.payee) || { spend: 0, count: 0 };
      v.spend += agg.cost;
      v.count++;
      acc.vendors.set(agg.payee, v);
    }
    cats.set(category, acc);
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const categories: CategoryAnalysis[] = [...cats.entries()]
    .map(([category, a]) => ({
      category,
      licensedTrade: LICENSED_TRADES.has(category),
      hdms: {
        count: a.hdms.count,
        spend: round2(a.hdms.spend),
        avgCost: a.hdms.count ? round2(a.hdms.spend / a.hdms.count) : 0,
        avgCycleDays: a.hdms.cycleN ? round2(a.hdms.cycleSum / a.hdms.cycleN) : null,
      },
      external: {
        count: a.external.count,
        spend: round2(a.external.spend),
        avgCost: a.external.count ? round2(a.external.spend / a.external.count) : 0,
        avgCycleDays: a.external.cycleN ? round2(a.external.cycleSum / a.external.cycleN) : null,
      },
      smallJobOpportunity: round2(a.smallJobOpportunity),
      smallJobCount: a.smallJobCount,
      topVendors: [...a.vendors.entries()]
        .map(([name, v]) => ({ name, spend: round2(v.spend), count: v.count }))
        .sort((x, y) => y.spend - x.spend)
        .slice(0, 3),
    }))
    .sort((x, y) => y.smallJobOpportunity - x.smallJobOpportunity);

  return {
    from,
    to,
    woCount: perWo.size,
    hdmsSpend: round2(totals.hdmsSpend),
    externalSpend: round2(totals.externalSpend),
    hdmsAvgCycleDays: totals.hdmsCycleN ? round2(totals.hdmsCycleSum / totals.hdmsCycleN) : null,
    externalAvgCycleDays: totals.extCycleN ? round2(totals.extCycleSum / totals.extCycleN) : null,
    smallJobOpportunityTotal: round2(
      categories.reduce((s, c) => s + c.smallJobOpportunity, 0)
    ),
    categories,
    unjoinedBillLines: unjoined,
  };
}
