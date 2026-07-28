import { HdmsInvoice, LineItem, lineCost, lineMarkup } from './invoices';

// ============================================
// Invoice cost/charge analysis
// ============================================
//
// Shared between the internal Markup Report (selection-report.tsx) and the
// payment reconciliation flow. `charged` fields are what the owner was billed
// (and therefore what a trust-account payment reconciles against); `cost` /
// `markup` are internal-only.

/** A materials/appliance bucket: cost basis, markup captured, and charged amount. */
export interface Group {
  cost: number; // material cost basis (falls back to charge when no cost recorded)
  markup: number; // charge − cost (0 when no cost recorded)
  charged: number; // amount billed to owner
  missingCost: number; // charged amount on lines with no cost recorded
}

/** A single invoice broken into labor / materials / appliance / other buckets. */
export interface Analysis {
  labor: number; // labor charged
  materials: Group;
  appliance: Group;
  other: number; // other charged
  total: number; // invoice total_amount
}

/** Aggregate of an Analysis across a set of invoices. */
export interface Totals {
  count: number;
  voidCount: number;
  labor: number;
  materials: Group;
  appliance: Group;
  other: number;
  grand: number; // sum of total_amount (excludes void — see aggregate())
}

export const emptyGroup = (): Group => ({ cost: 0, markup: 0, charged: 0, missingCost: 0 });

/** Break a single invoice into labor / materials / appliance / other buckets. */
export function analyze(inv: HdmsInvoice): Analysis {
  const materials = emptyGroup();
  const appliance = emptyGroup();
  let labor = 0;
  let other = 0;

  const items: LineItem[] = inv.line_items || [];

  if (items.length > 0) {
    for (const li of items) {
      const type = li.type || 'labor';
      const amount = li.amount || 0;
      if (type === 'labor') {
        labor += amount;
      } else if (type === 'materials' || type === 'appliance') {
        const g = type === 'appliance' ? appliance : materials;
        const cost = lineCost(li);
        g.charged += amount;
        if (cost > 0) {
          g.cost += cost;
          g.markup += lineMarkup(li);
        } else {
          // No cost recorded — treat the charge as cost so margin isn't overstated.
          g.cost += amount;
          g.missingCost += amount;
        }
      } else {
        other += amount;
      }
    }
  } else {
    // Legacy invoice with no line items — attribute the aggregate columns, no markup.
    labor = inv.labor_amount || 0;
    materials.charged = inv.materials_amount || 0;
    materials.cost = inv.materials_amount || 0;
    materials.missingCost = inv.materials_amount || 0;
  }

  return { labor, materials, appliance, other, total: inv.total_amount || 0 };
}

/**
 * Aggregate a set of invoices into running totals.
 * Void invoices are counted (voidCount) but excluded from every dollar figure,
 * since a trust-account payment only covers live invoices.
 */
export function aggregate(invoices: HdmsInvoice[]): Totals {
  const t: Totals = {
    count: invoices.length,
    voidCount: 0,
    labor: 0,
    materials: emptyGroup(),
    appliance: emptyGroup(),
    other: 0,
    grand: 0,
  };
  for (const inv of invoices) {
    if (inv.status === 'void') {
      t.voidCount++;
      continue;
    }
    const a = analyze(inv);
    t.labor += a.labor;
    t.other += a.other;
    t.grand += a.total;
    for (const key of ['cost', 'markup', 'charged', 'missingCost'] as const) {
      t.materials[key] += a.materials[key];
      t.appliance[key] += a.appliance[key];
    }
  }
  return t;
}

/** The labor / materials / appliance / other charged split that makes up a payment. */
export interface ChargedSplit {
  labor: number;
  materials: number; // materials.charged only (appliances broken out separately)
  appliance: number; // appliance.charged
  other: number;
  total: number; // sum of live total_amount
}

/** Reduce Totals to the owner-charged split used for payment reconciliation. */
export function chargedSplit(t: Totals): ChargedSplit {
  return {
    labor: t.labor,
    materials: t.materials.charged,
    appliance: t.appliance.charged,
    other: t.other,
    total: t.grand,
  };
}
