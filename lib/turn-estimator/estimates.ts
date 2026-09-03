/**
 * Turn Estimator — estimate lifecycle (Slice 0).
 *
 * An estimate has a mutable header + immutable versions. Issuing a version
 * prices the lines at the current price-book (priced_asof), writes an immutable
 * estimate_version + estimate_lines, and evaluates the owner total against the
 * authorization limit. Every mutation is audited.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import { priceEstimate, evaluateAuthorization } from './pricing';
import { getEstimatorConfig } from './config';
import type { LineInput, PricedLine } from './types';

export interface CreateEstimateInput {
  unit_turn_id?: string | null;
  property_id?: string | null;
  property_name?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  authorization_limit?: number | null;
}

export interface EstimateRow {
  id: string;
  status: string;
  current_version_id: string | null;
  authorization_limit: number | null;
  unit_turn_id: string | null;
  property_name: string | null;
  unit_name: string | null;
}

export async function createEstimate(input: CreateEstimateInput, actor: string): Promise<EstimateRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('estimate')
    .insert({
      unit_turn_id: input.unit_turn_id ?? null,
      property_id: input.property_id ?? null,
      property_name: input.property_name ?? null,
      unit_id: input.unit_id ?? null,
      unit_name: input.unit_name ?? null,
      authorization_limit: input.authorization_limit ?? null,
      created_by: actor,
    })
    .select()
    .single();
  if (error) throw new Error(`create estimate failed: ${error.message}`);
  await logAudit('estimate', data.id as string, 'estimate_create', actor, {
    property_name: input.property_name ?? null,
    unit_turn_id: input.unit_turn_id ?? null,
  });
  return data as EstimateRow;
}

export interface IssueVersionResult {
  version_id: string;
  version_number: number;
  lines: PricedLine[];
  owner_total: number;
  internal_cost_total: number;
  margin: number;
  authorization: 'auto_approved' | 'approval_pending';
  estimate_status: string;
}

/**
 * Price the given lines and write an immutable version + lines. Evaluates the
 * owner total against the estimate's authorization limit (or the config default)
 * and sets the estimate status accordingly. Supersedes any prior current version.
 */
export async function issueEstimateVersion(
  estimateId: string,
  lineInputs: LineInput[],
  actor: string,
  opts: { notes?: string; pricedAsof?: string } = {}
): Promise<IssueVersionResult> {
  const supabase = getSupabaseAdmin();
  const cfg = await getEstimatorConfig();

  const { data: est, error: estErr } = await supabase
    .from('estimate')
    .select('id, status, current_version_id, authorization_limit')
    .eq('id', estimateId)
    .single();
  if (estErr || !est) throw new Error(`estimate not found: ${estErr?.message}`);
  if (est.status === 'void') throw new Error('cannot issue a version on a void estimate');

  const { lines, totals } = priceEstimate(lineInputs, cfg);

  // Next version number.
  const { data: last } = await supabase
    .from('estimate_version')
    .select('version_number')
    .eq('estimate_id', estimateId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = ((last?.version_number as number) ?? 0) + 1;

  const pricedAsof = opts.pricedAsof ?? new Date().toISOString().slice(0, 10);

  const { data: version, error: verErr } = await supabase
    .from('estimate_version')
    .insert({
      estimate_id: estimateId,
      version_number: versionNumber,
      status: 'issued',
      owner_total: totals.owner_total,
      internal_cost_total: totals.internal_cost_total,
      tenant_alloc_proposed_total: totals.tenant_alloc_proposed_total,
      margin: totals.margin,
      priced_asof: pricedAsof,
      notes: opts.notes ?? null,
      created_by: actor,
    })
    .select()
    .single();
  if (verErr || !version) throw new Error(`issue version failed: ${verErr?.message}`);

  const lineRows = lines.map((l, i) => ({
    estimate_version_id: version.id,
    line_no: i + 1,
    price_book_item_id: l.price_book_item_id,
    price_book_item_code: l.price_book_item_code,
    category: l.category,
    pricing_method: l.pricing_method,
    description: l.description,
    room: l.room,
    location: l.location,
    qty: l.qty,
    uom: l.uom,
    est_labor_hours: l.est_labor_hours,
    est_material_cost: l.est_material_cost,
    internal_cost: l.internal_cost,
    owner_unit_price: l.owner_unit_price,
    owner_extended: l.owner_extended,
    tax_amount: l.tax_amount,
    tenant_alloc_proposed: l.tenant_alloc_proposed,
    responsibility: l.responsibility,
    responsibility_rationale: l.responsibility_rationale,
  }));
  if (lineRows.length > 0) {
    const { error: lineErr } = await supabase.from('estimate_line').insert(lineRows);
    if (lineErr) throw new Error(`insert estimate lines failed: ${lineErr.message}`);
  }

  // Supersede the prior current version.
  if (est.current_version_id) {
    await supabase
      .from('estimate_version')
      .update({ status: 'superseded' })
      .eq('id', est.current_version_id);
  }

  const limit = (est.authorization_limit as number | null) ?? cfg.default_authorization_limit;
  const authorization = evaluateAuthorization(totals.owner_total, limit);
  const estimateStatus = authorization === 'auto_approved' ? 'approved' : 'approval_pending';

  await supabase
    .from('estimate')
    .update({ current_version_id: version.id, status: estimateStatus })
    .eq('id', estimateId);

  await logAudit('estimate', estimateId, 'estimate_version_issued', actor, {
    version_id: version.id,
    version_number: versionNumber,
    owner_total: totals.owner_total,
    authorization,
    limit,
  });

  return {
    version_id: version.id,
    version_number: versionNumber,
    lines,
    owner_total: totals.owner_total,
    internal_cost_total: totals.internal_cost_total,
    margin: totals.margin,
    authorization,
    estimate_status: estimateStatus,
  };
}

/** Record an owner/PM/OPS approval request against a version. */
export async function requestApproval(
  versionId: string,
  kind: 'OWNER' | 'PM' | 'OPS',
  actor: string
): Promise<{ id: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('estimate_approval')
    .insert({ estimate_version_id: versionId, kind, requested_by: actor })
    .select('id')
    .single();
  if (error) throw new Error(`request approval failed: ${error.message}`);
  await logAudit('estimate_version', versionId, 'approval_request', actor, { kind, approval_id: data.id });
  return data as { id: string };
}

/**
 * Decide an approval. On APPROVED, mark the version approved and the estimate
 * approved. Audited with the decision + reason.
 */
export async function decideApproval(
  approvalId: string,
  decision: 'APPROVED' | 'DECLINED' | 'CHANGES',
  actor: string,
  opts: { approvedAmount?: number; conditions?: string; reason?: string } = {}
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: appr, error: aErr } = await supabase
    .from('estimate_approval')
    .select('id, estimate_version_id, decision')
    .eq('id', approvalId)
    .single();
  if (aErr || !appr) throw new Error(`approval not found: ${aErr?.message}`);
  if (appr.decision) return; // already decided — idempotent

  const { error: updErr } = await supabase
    .from('estimate_approval')
    .update({
      decision,
      decided_by: actor,
      decided_at: new Date().toISOString(),
      approved_amount: opts.approvedAmount ?? null,
      conditions: opts.conditions ?? null,
      reason: opts.reason ?? null,
    })
    .eq('id', approvalId);
  if (updErr) throw new Error(`decide approval failed: ${updErr.message}`);

  if (decision === 'APPROVED') {
    await supabase
      .from('estimate_version')
      .update({ status: 'approved' })
      .eq('id', appr.estimate_version_id);
    const { data: ver } = await supabase
      .from('estimate_version')
      .select('estimate_id')
      .eq('id', appr.estimate_version_id)
      .single();
    if (ver?.estimate_id) {
      await supabase.from('estimate').update({ status: 'approved' }).eq('id', ver.estimate_id);
    }
  } else if (decision === 'DECLINED') {
    const { data: ver } = await supabase
      .from('estimate_version')
      .select('estimate_id')
      .eq('id', appr.estimate_version_id)
      .single();
    if (ver?.estimate_id) {
      await supabase.from('estimate').update({ status: 'declined' }).eq('id', ver.estimate_id);
    }
  }

  await logAudit('estimate_version', appr.estimate_version_id, 'approval_decision', actor, {
    approval_id: approvalId,
    decision,
    approved_amount: opts.approvedAmount ?? null,
    reason: opts.reason ?? null,
  });
}
