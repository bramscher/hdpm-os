/**
 * Turn Estimator — convert an approved estimate version to a draft invoice.
 *
 * Reuses the existing hdms_invoices spine (so the PDF, payments, reconcile, and
 * af_bills matching keep working unchanged). Maps immutable estimate_lines to the
 * existing LineItem shape, stamps source_estimate_version_id, and is guarded
 * against double-billing (a unique partial index + a pre-check). Audited.
 */

import { getSupabaseAdmin } from '@/lib/supabase';
import { logAudit } from '@/lib/audit';
import type { LineItem, LineItemType } from '@/lib/invoices';
import type { PricingMethod } from './types';

/** Map an estimate line's category/method to an invoice LineItem type. */
function lineItemType(category: string, method: PricingMethod): LineItemType {
  const c = category.toLowerCase();
  if (c.includes('appliance')) return 'appliance';
  if (method === 'cost_plus' || c.includes('material')) return 'materials';
  if (method === 'hourly' || method === 'service_min' || c.includes('labor') || c.includes('handyman'))
    return 'labor';
  return 'other';
}

export interface ConvertResult {
  invoice_id: string;
  invoice_code: string;
  total_amount: number;
}

export async function convertEstimateVersionToInvoice(
  versionId: string,
  actor: string
): Promise<ConvertResult> {
  const supabase = getSupabaseAdmin();

  // Load the version, its estimate, and its lines.
  const { data: version, error: vErr } = await supabase
    .from('estimate_version')
    .select('id, estimate_id, owner_total, version_number')
    .eq('id', versionId)
    .single();
  if (vErr || !version) throw new Error(`estimate version not found: ${vErr?.message}`);

  const { data: est, error: eErr } = await supabase
    .from('estimate')
    .select('id, status, property_name, unit_name, property_id')
    .eq('id', version.estimate_id)
    .single();
  if (eErr || !est) throw new Error(`estimate not found: ${eErr?.message}`);
  if (est.status !== 'approved') {
    throw new Error(`estimate must be approved to convert (status: ${est.status})`);
  }

  // Double-bill guard (also enforced by a unique partial index).
  const { data: existing } = await supabase
    .from('hdms_invoices')
    .select('id, invoice_code')
    .eq('source_estimate_version_id', versionId)
    .neq('status', 'void')
    .maybeSingle();
  if (existing) {
    throw new Error(`estimate version already billed on invoice ${existing.invoice_code}`);
  }

  const { data: lineRows, error: lErr } = await supabase
    .from('estimate_line')
    .select('*')
    .eq('estimate_version_id', versionId)
    .order('line_no');
  if (lErr) throw new Error(`load estimate lines failed: ${lErr.message}`);

  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const lineItems: LineItem[] = (lineRows ?? []).map((r) => {
    const type = lineItemType(r.category ?? '', r.pricing_method as PricingMethod);
    const amount = num(r.owner_extended) + num(r.tax_amount);
    const li: LineItem = {
      description: r.description as string,
      type,
      qty: num(r.qty),
      unit_price: num(r.owner_unit_price),
      amount: Math.round(amount * 100) / 100,
    };
    // Carry internal cost only on material/appliance lines (matches invoice convention).
    if ((type === 'materials' || type === 'appliance') && r.internal_cost != null) {
      li.cost = num(r.internal_cost);
    }
    return li;
  });

  const sumBy = (pred: (t: LineItemType) => boolean) =>
    Math.round(
      lineItems.filter((li) => pred(li.type ?? 'other')).reduce((s, li) => s + li.amount, 0) * 100
    ) / 100;
  const laborAmount = sumBy((t) => t === 'labor');
  const materialsAmount = sumBy((t) => t === 'materials' || t === 'appliance');
  const totalAmount = Math.round(lineItems.reduce((s, li) => s + li.amount, 0) * 100) / 100;

  const { data: inv, error: iErr } = await supabase
    .from('hdms_invoices')
    .insert({
      property_name: est.property_name ?? 'Unknown',
      property_address: est.property_id ?? '',
      description: `Turn estimate v${version.version_number}${est.unit_name ? ` — ${est.unit_name}` : ''}`,
      labor_amount: laborAmount,
      materials_amount: materialsAmount,
      total_amount: totalAmount,
      line_items: lineItems.length ? lineItems : null,
      source_estimate_version_id: versionId,
      created_by: actor,
    })
    .select('id, invoice_code, total_amount')
    .single();
  if (iErr) {
    // Unique-index violation = someone billed it concurrently.
    if (iErr.code === '23505') {
      throw new Error('estimate version already billed (concurrent) — refresh');
    }
    throw new Error(`create invoice from estimate failed: ${iErr.message}`);
  }

  await logAudit('estimate_version', versionId, 'converted_to_invoice', actor, {
    invoice_id: inv.id,
    invoice_code: inv.invoice_code,
    total_amount: inv.total_amount,
  });

  return {
    invoice_id: inv.id as string,
    invoice_code: inv.invoice_code as string,
    total_amount: num(inv.total_amount),
  };
}
