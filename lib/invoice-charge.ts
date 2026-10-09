/**
 * Owner charge / Tenant charge. Every HDMS invoice says who pays, and one
 * invoice is never both: the payer is a property of the invoice, not of its
 * line items. These rules mirror the hdms_invoices_charge_to_fields CHECK in
 * supabase/migrations/20261006_invoice_charge_to.sql so the API can explain
 * a problem before the database rejects it.
 *
 * Posting model (2026-10-02): the owner still pays HDMS's bill; a tenant
 * charge is also posted to the tenant ledger to reimburse the owner.
 */

export type ChargeTo = 'owner' | 'tenant';
export type TenantChargeReason = 'tenant_damage' | 'lease_fee' | 'other';

export const TENANT_REASON_LABEL: Record<TenantChargeReason, string> = {
  tenant_damage: 'Tenant damage',
  lease_fee: 'Lease fee',
  other: 'Other',
};

export interface ChargeFields {
  charge_to?: ChargeTo | string | null;
  tenant_name?: string | null;
  tenant_unit?: string | null;
  tenant_charge_reason?: TenantChargeReason | string | null;
  tenant_charge_note?: string | null;
  lease_clause?: string | null;
}

/** Validated payer values, as written to the database. */
export interface ChargeValues {
  charge_to?: ChargeTo;
  tenant_name?: string | null;
  tenant_unit?: string | null;
  tenant_charge_reason?: TenantChargeReason | null;
  tenant_charge_note?: string | null;
  lease_clause?: string | null;
}

/** The keys a client may send for who pays. */
export const CHARGE_FIELD_KEYS = ['charge_to', 'tenant_name', 'tenant_unit', 'tenant_charge_reason', 'tenant_charge_note', 'lease_clause'] as const;

const TENANT_KEYS = ['tenant_name', 'tenant_unit', 'tenant_charge_reason', 'tenant_charge_note', 'lease_clause'] as const;

export class ChargeValidationError extends Error {}

const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

/**
 * A tenant name typed only to get past the required field ("na", "n/a",
 * "none", "tbd", "?"). A real tenant charge needs the person on the lease;
 * typing a placeholder usually means nobody meant to charge a tenant.
 */
export function isPlaceholderName(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const t = v.trim().toLowerCase().replace(/[\s.\-_/\\?!*]+/g, '');
  return t === '' || ['na', 'none', 'tbd', 'tba', 'unknown', 'nobody', 'tenant', 'x', 'xx', 'xxx', 'test', 'nil', 'null'].includes(t);
}

// Wording that describes damage the tenant didn't cause — usually the owner's cost.
const PRE_EXISTING: { re: RegExp; phrase: string }[] = [
  { re: /\b(old|prior|previous|existing|pre[-\s]?existing)\s+(damage|issue|problem|repair)s?\b/i, phrase: 'pre-existing damage' },
  { re: /\b(previous|prior|old|former|last)\s+(tenant|resident|occupant)s?\b/i, phrase: 'a previous tenant' },
  { re: /\bnew\s+(tenant|resident|move[-\s]?in)\b/i, phrase: 'a new tenant' },
  { re: /\bmove[-\s]?in\b|\bbefore\s+(she|he|they|the tenant)\s+(moves?|moved|settles?|settled)\b/i, phrase: 'move-in' },
  { re: /\b(normal|ordinary|regular)\s+wear\b|\bwear\s+(and|&)\s+tear\b/i, phrase: 'normal wear and tear' },
  { re: /\b(age|aged|old age|end of (its )?life|worn out)\b/i, phrase: 'age or wear' },
  { re: /\balready\s+(broken|damaged|cracked|there)\b|\bwhen (she|he|they) moved in\b/i, phrase: 'damage that was already there' },
];

/**
 * Phrases in a tenant-charge note suggesting the damage wasn't the tenant's
 * doing (pre-existing, move-in, normal wear). A warning only — the office
 * decides — but it catches charges marked Tenant by mistake.
 */
export function ownerCostSignals(note: unknown): string[] {
  if (typeof note !== 'string' || !note.trim()) return [];
  return [...new Set(PRE_EXISTING.filter((p) => p.re.test(note)).map((p) => p.phrase))];
}
const clean = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function isChargeTo(v: unknown): v is ChargeTo {
  return v === 'owner' || v === 'tenant';
}

export function isTenantReason(v: unknown): v is TenantChargeReason {
  return v === 'tenant_damage' || v === 'lease_fee' || v === 'other';
}

/**
 * Tidy the payer fields in a create/update body. Only keys the caller sent
 * are touched, except that choosing Owner clears every tenant field (an owner
 * charge never carries a tenant). Throws on an unknown payer or reason.
 */
export function normalizeChargeFields(input: ChargeFields): ChargeValues {
  const out: ChargeFields = {};
  if ('charge_to' in input) {
    if (!isChargeTo(input.charge_to)) throw new ChargeValidationError('Choose who pays: Owner or Tenant.');
    out.charge_to = input.charge_to;
  }
  for (const k of TENANT_KEYS) if (k in input) out[k] = clean(input[k]);
  if (out.tenant_charge_reason != null && !isTenantReason(out.tenant_charge_reason)) {
    throw new ChargeValidationError('Choose a reason for the tenant charge: tenant damage, lease fee or other.');
  }
  if (out.charge_to === 'owner') for (const k of TENANT_KEYS) out[k] = null;
  return out as ChargeValues;
}

/**
 * Problems that stop an invoice from being generated, in plain language.
 * Drafts may be incomplete; pass finalizing to check what generating needs:
 * the tenant, unit and what happened. The reason and lease clause are optional
 * here (techs often don't know them) — the office adds them when posting the
 * charge to the tenant ledger (see ledgerProblems).
 */
export function chargeProblems(inv: ChargeFields, { finalizing }: { finalizing: boolean }): string[] {
  const charge = inv.charge_to ?? 'owner';
  if (!isChargeTo(charge)) return ['Choose who pays: Owner or Tenant.'];
  if (charge === 'owner' || !finalizing) return [];
  const problems: string[] = [];
  if (blank(inv.tenant_name) || blank(inv.tenant_unit)) problems.push('A tenant charge needs the tenant’s name and unit.');
  else if (isPlaceholderName(inv.tenant_name)) {
    problems.push(`“${String(inv.tenant_name).trim()}” isn’t a tenant’s name. Enter the name on the lease — or, if no tenant caused this, make it an Owner charge.`);
  }
  if (blank(inv.tenant_charge_note)) problems.push('Add a note explaining the tenant charge (what happened, and the evidence).');
  return problems;
}

/**
 * The full basis needed before a charge is posted to the tenant's ledger
 * (ORS 90): everything generating needs, plus the reason, and the lease
 * clause for a lease fee.
 */
export function ledgerProblems(inv: ChargeFields): string[] {
  if (inv.charge_to !== 'tenant') return ['This is an owner charge; there is no tenant ledger charge to post.'];
  const problems = chargeProblems(inv, { finalizing: true });
  if (!isTenantReason(inv.tenant_charge_reason)) problems.push('Choose why the tenant is being charged: tenant damage, lease fee or other.');
  if (inv.tenant_charge_reason === 'lease_fee' && blank(inv.lease_clause)) problems.push('A lease fee needs the lease clause that allows it.');
  return problems;
}

/** Throw the first problem, for API routes. */
export function assertChargeComplete(inv: ChargeFields, opts: { finalizing: boolean }): void {
  const problems = chargeProblems(inv, opts);
  if (problems.length) throw new ChargeValidationError(problems.join(' '));
}

/**
 * The payer columns to write for an edit: the stored values with the edit's
 * (normalized) changes applied, so a partial PATCH can't leave an owner
 * invoice holding tenant fields. Returns {} when the edit doesn't touch them.
 */
export function mergeChargeUpdate(existing: ChargeFields, patch: ChargeFields): ChargeValues {
  if (!CHARGE_FIELD_KEYS.some((k) => k in patch)) return {};
  const next = normalizeChargeFields(patch);
  return chargeFieldsFrom({ ...chargeFieldsFrom(existing), ...next });
}

/** Just the payer keys present in a request body, normalized. */
export function pickChargeFields(body: object): ChargeValues {
  const src = body as Record<string, unknown>;
  const picked = Object.fromEntries(CHARGE_FIELD_KEYS.filter((k) => Object.hasOwn(src, k)).map((k) => [k, src[k]])) as ChargeFields;
  return normalizeChargeFields(picked);
}

/** "Owner charge" or "Tenant charge · Jane Doe, unit 4". */
export function chargeLabel(inv: ChargeFields): string {
  if ((inv.charge_to ?? 'owner') !== 'tenant') return 'Owner charge';
  const who = [clean(inv.tenant_name), clean(inv.tenant_unit) ? `unit ${clean(inv.tenant_unit)}` : null].filter(Boolean).join(', ');
  return who ? `Tenant charge · ${who}` : 'Tenant charge';
}

/** Copy who pays from the invoice a credit memo corrects. */
export function chargeFieldsFrom(source: ChargeFields): Required<ChargeValues> {
  const charge: ChargeTo = source.charge_to === 'tenant' ? 'tenant' : 'owner';
  return {
    charge_to: charge,
    tenant_name: charge === 'tenant' ? clean(source.tenant_name) : null,
    tenant_unit: charge === 'tenant' ? clean(source.tenant_unit) : null,
    tenant_charge_reason: charge === 'tenant' && isTenantReason(source.tenant_charge_reason) ? source.tenant_charge_reason : null,
    tenant_charge_note: charge === 'tenant' ? clean(source.tenant_charge_note) : null,
    lease_clause: charge === 'tenant' ? clean(source.lease_clause) : null,
  };
}
