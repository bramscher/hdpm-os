/**
 * Maintenance OS — the 12 tripwires (docs/maintenance-os/02-functional-spec.md §5).
 *
 * Each rule is a pure function (snapshot) => TripwireException[] so every one
 * is unit-testable without a database. The engine (tripwire-engine.ts) loads
 * one snapshot and runs the registry with per-rule error capture.
 *
 * Principle: no job may ever be in a state where zero people are obligated
 * to act on it by a specific date.
 */

import type {
  MaintWorkOrder,
  TripwireException,
  TripwireNumber,
  TripwireSnapshot,
} from './types';
import { businessDaysBetween, daysBetween } from './business-days';

export const TRIPWIRE_LABELS: Record<TripwireNumber, string> = {
  1: '#1 Request never became a WO',
  2: '#2 WO unassigned > 1 business day',
  3: '#3 Past-due or missing next action',
  4: '#4 Vendor unaccepted > 24h',
  5: '#5 Failed access — new date required today',
  6: '#6 Scope change without approval',
  7: '#7 VERIFY docs missing',
  8: '#8 Verified > 5 days, unbilled',
  9: '#9 Tenant confirmation missing',
  10: '#10 Tech recommendation unresolved > 3 days',
  11: '#11 Owner approval pending > 3 business days',
  12: '#12 Turn without next action',
};

function woLabel(wo: MaintWorkOrder): string {
  const where = wo.unit_name
    ? `${wo.property_name} #${wo.unit_name}`
    : wo.property_name;
  return `${wo.description.slice(0, 60)} — ${where}`;
}

function dateStr(d: string | null): string {
  return d ? d.slice(0, 10) : 'none';
}

// ── #1: Haven contact-log entry with no matching WO by next morning ──
// STUB — no Haven.AI integration exists yet.
// TODO(Haven.AI): wire contact-log ingestion (API/export), then diff
// yesterday's maintenance-intent contacts against work_orders.created_at.
export function tripwire1(_snapshot: TripwireSnapshot): TripwireException[] {
  return [];
}

// ── #2: WO never assigned — NEW (or ownerless) > 1 business day ──
export function tripwire2(snapshot: TripwireSnapshot): TripwireException[] {
  return snapshot.openWorkOrders
    .filter((wo) => {
      // AppFolio's CreatedAt, not our row timestamp (catch-up syncs insert old rows fresh)
      const created = new Date(wo.appfolio_created_at ?? wo.created_at);
      const age = businessDaysBetween(created, snapshot.now);
      return (wo.stage === 'NEW' && age > 1) || !wo.owner_name;
    })
    .map((wo) => ({
      tripwire: 2 as const,
      label: TRIPWIRE_LABELS[2],
      item: `[${wo.stage}] ${woLabel(wo)}`,
      fixRequired: wo.owner_name
        ? 'Triage today: set priority + dispatch decision'
        : 'Assign an HDPM owner today',
      owner: wo.owner_name || 'Cheryl',
      workOrderId: wo.id,
      ageDays: businessDaysBetween(
        new Date(wo.appfolio_created_at ?? wo.created_at),
        snapshot.now
      ),
    }));
}

// ── #3: next_action_date blank or past on an open WO ──
export function tripwire3(snapshot: TripwireSnapshot): TripwireException[] {
  const today = snapshot.now.toISOString().slice(0, 10);
  return snapshot.openWorkOrders
    .filter((wo) => !wo.next_action_date || wo.next_action_date < today)
    .map((wo) => ({
      tripwire: 3 as const,
      label: TRIPWIRE_LABELS[3],
      item: `[${wo.stage}${wo.waiting_reason ? `-${wo.waiting_reason}` : ''}] ${woLabel(wo)} — due ${dateStr(wo.next_action_date)}`,
      fixRequired: 'Act or log a new next-action date today',
      owner: wo.owner_name || 'Cheryl',
      workOrderId: wo.id,
      ageDays: wo.next_action_date
        ? daysBetween(new Date(wo.next_action_date), snapshot.now)
        : undefined,
    }));
}

// ── #4: vendor assignment unaccepted > 24 hours ──
export function tripwire4(snapshot: TripwireSnapshot): TripwireException[] {
  const woById = new Map(snapshot.openWorkOrders.map((wo) => [wo.id, wo]));
  const vendorById = new Map(snapshot.vendors.map((v) => [v.id, v]));

  return snapshot.assignments
    .filter((a) => {
      if (a.accepted_at || a.declined_at) return false;
      if (!woById.has(a.work_order_id)) return false; // closed WOs don't chase
      return snapshot.now.getTime() - new Date(a.sent_at).getTime() > 24 * 3600_000;
    })
    .map((a) => {
      const wo = woById.get(a.work_order_id)!;
      const vendor = vendorById.get(a.vendor_id);
      const days = daysBetween(new Date(a.sent_at), snapshot.now);
      return {
        tripwire: 4 as const,
        label: TRIPWIRE_LABELS[4],
        item: `${vendor?.name || 'Vendor'} — ${woLabel(wo)} (day ${days})`,
        fixRequired: 'Phone call today; confirm and mark accepted, or reassign',
        owner: 'Cheryl',
        workOrderId: wo.id,
        ageDays: days,
      };
    });
}

// ── #5: failed access logged — WO must get a new date the same day ──
// The event handler already auto-returns the WO to SCHEDULED; this surfaces
// any failed-access WO still lacking a future next-action date today.
export function tripwire5(snapshot: TripwireSnapshot): TripwireException[] {
  const today = snapshot.now.toISOString().slice(0, 10);
  return snapshot.openWorkOrders
    .filter(
      (wo) =>
        snapshot.recentFailedAccessWoIds.has(wo.id) &&
        (!wo.next_action_date || wo.next_action_date <= today)
    )
    .map((wo) => ({
      tripwire: 5 as const,
      label: TRIPWIRE_LABELS[5],
      item: woLabel(wo),
      fixRequired: 'Failed access logged — schedule a new date with tenant today',
      owner: wo.owner_name || 'Cheryl',
      workOrderId: wo.id,
    }));
}

// ── #6: scope-change event without a matching approval ──
export function tripwire6(snapshot: TripwireSnapshot): TripwireException[] {
  return snapshot.openWorkOrders
    .filter((wo) => {
      const docs = snapshot.docsByWorkOrder.get(wo.id);
      return docs ? docs.scopeChanges > docs.approvedDecisions : false;
    })
    .map((wo) => {
      const docs = snapshot.docsByWorkOrder.get(wo.id)!;
      return {
        tripwire: 6 as const,
        label: TRIPWIRE_LABELS[6],
        item: `${woLabel(wo)} — ${docs.scopeChanges - docs.approvedDecisions} unapproved scope change(s)`,
        fixRequired: 'Get approval recorded before any billing (bill is blocked)',
        owner: 'Alberto',
        workOrderId: wo.id,
      };
    });
}

// ── #7: in VERIFY without photos + time + materials ──
export function tripwire7(snapshot: TripwireSnapshot): TripwireException[] {
  return snapshot.openWorkOrders
    .filter((wo) => {
      if (wo.stage !== 'VERIFY') return false;
      const docs = snapshot.docsByWorkOrder.get(wo.id);
      return !docs || docs.photoCount === 0 || !docs.hasTime || !docs.hasMaterials;
    })
    .map((wo) => {
      const docs = snapshot.docsByWorkOrder.get(wo.id);
      const missing = [
        !docs || docs.photoCount === 0 ? 'photos' : null,
        !docs || !docs.hasTime ? 'time' : null,
        !docs || !docs.hasMaterials ? 'materials' : null,
      ].filter(Boolean);
      return {
        tripwire: 7 as const,
        label: TRIPWIRE_LABELS[7],
        item: `${woLabel(wo)} — missing: ${missing.join(', ')}`,
        fixRequired: 'Complete documentation (bill is blocked until done)',
        owner: wo.assigned_tech || wo.owner_name || 'Alberto',
        workOrderId: wo.id,
      };
    });
}

// ── #8: verified > 5 days ago and still no invoice ──
export function tripwire8(snapshot: TripwireSnapshot): TripwireException[] {
  return snapshot.openWorkOrders
    .filter((wo) => {
      if (!wo.verified_at) return false;
      if (snapshot.invoicedWorkOrderIds.has(wo.id)) return false;
      return daysBetween(new Date(wo.verified_at), snapshot.now) > 5;
    })
    .map((wo) => {
      const days = daysBetween(new Date(wo.verified_at!), snapshot.now);
      return {
        tripwire: 8 as const,
        label: TRIPWIRE_LABELS[8],
        item: `${woLabel(wo)} (day ${days})`,
        fixRequired: 'Generate the invoice in hdpm-chat today',
        owner: wo.assigned_tech || wo.owner_name || 'Penny',
        workOrderId: wo.id,
        ageDays: days,
      };
    });
}

// ── #9: tenant ping negative OR silent > 5d on P1/P2 ──
// STUB — depends on Haven.AI tenant confirmation pings.
// TODO(Haven.AI): once ping replies flow in as wo_event('tenant_reply'),
// flag negative replies and P1/P2 closes silent > 5 days.
export function tripwire9(_snapshot: TripwireSnapshot): TripwireException[] {
  return [];
}

// ── #10: tech recommendation older than 3 days, no WO and no dismissal ──
export function tripwire10(snapshot: TripwireSnapshot): TripwireException[] {
  return snapshot.recommendations
    .filter(
      (rec) =>
        !rec.resolved_wo_id &&
        !rec.dismissed_reason &&
        daysBetween(new Date(rec.created_at), snapshot.now) > 3
    )
    .map((rec) => ({
      tripwire: 10 as const,
      label: TRIPWIRE_LABELS[10],
      item: `${rec.tech}: ${rec.body.slice(0, 80)}`,
      fixRequired: 'Create a WO or dismiss in writing',
      owner: 'Alberto',
      workOrderId: rec.work_order_id ?? undefined,
      ageDays: daysBetween(new Date(rec.created_at), snapshot.now),
    }));
}

// ── #11: owner approval pending > 3 business days ──
export function tripwire11(snapshot: TripwireSnapshot): TripwireException[] {
  const woById = new Map(snapshot.openWorkOrders.map((wo) => [wo.id, wo]));
  return snapshot.approvals
    .filter(
      (a) =>
        !a.decided_at &&
        businessDaysBetween(new Date(a.requested_at), snapshot.now) > 3
    )
    .map((a) => {
      const wo = woById.get(a.work_order_id);
      const days = businessDaysBetween(new Date(a.requested_at), snapshot.now);
      return {
        tripwire: 11 as const,
        label: TRIPWIRE_LABELS[11],
        item: `${a.kind} approval from ${a.requested_of}${wo ? ` — ${woLabel(wo)}` : ''} (day ${days})`,
        fixRequired: 'PM follows up with decision-maker today',
        owner: 'Jen',
        workOrderId: a.work_order_id,
        ageDays: days,
      };
    });
}

// ── #12: turn with no next action ──
export function tripwire12(snapshot: TripwireSnapshot): TripwireException[] {
  const woById = new Map(snapshot.openWorkOrders.map((wo) => [wo.id, wo]));
  return snapshot.turns
    .filter((t) => {
      const wo = woById.get(t.work_order_id);
      return wo ? !wo.next_action_date : false;
    })
    .map((t) => {
      const wo = woById.get(t.work_order_id)!;
      const daysVacant = daysBetween(new Date(t.vacated_at), snapshot.now);
      return {
        tripwire: 12 as const,
        label: TRIPWIRE_LABELS[12],
        item: `${woLabel(wo)} — vacant ${daysVacant} days, no next action`,
        fixRequired: 'Set the next action + date (vacancy is rent lost daily)',
        owner: wo.owner_name || 'Cheryl',
        workOrderId: wo.id,
        ageDays: daysVacant,
      };
    });
}

/** Registry the engine iterates, in spec order. */
export const TRIPWIRE_REGISTRY: {
  n: TripwireNumber;
  run: (s: TripwireSnapshot) => TripwireException[];
}[] = [
  { n: 1, run: tripwire1 },
  { n: 2, run: tripwire2 },
  { n: 3, run: tripwire3 },
  { n: 4, run: tripwire4 },
  { n: 5, run: tripwire5 },
  { n: 6, run: tripwire6 },
  { n: 7, run: tripwire7 },
  { n: 8, run: tripwire8 },
  { n: 9, run: tripwire9 },
  { n: 10, run: tripwire10 },
  { n: 11, run: tripwire11 },
  { n: 12, run: tripwire12 },
];
