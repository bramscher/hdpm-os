/**
 * Persisted reconciliation checkbox selections ("save & resume").
 *
 * While reconciling a period the user selects invoices across the whole period;
 * this store keeps that selection per user + period so they can leave and come
 * back. The draft is deleted once the period's payment is recorded.
 *
 * A "period" is just the reconcile view's date-range filter (YYYY-MM-DD strings,
 * or '' for an open bound) — the app has no first-class period entity.
 */

import { getSupabaseAdmin } from './supabase';

export interface ReconcileSelection {
  invoice_ids: string[];
  filters: Record<string, unknown> | null;
}

/** Normalize a period into the two non-null text keys the store is keyed by. */
export function periodKey(
  from: string | null | undefined,
  to: string | null | undefined
): { period_from: string; period_to: string } {
  return { period_from: from || '', period_to: to || '' };
}

export async function getReconcileSelection(
  createdBy: string,
  from: string,
  to: string
): Promise<ReconcileSelection | null> {
  const supabase = getSupabaseAdmin();
  const { period_from, period_to } = periodKey(from, to);
  const { data, error } = await supabase
    .from('hdms_reconcile_selection')
    .select('invoice_ids, filters')
    .eq('created_by', createdBy)
    .eq('period_from', period_from)
    .eq('period_to', period_to)
    .maybeSingle();
  if (error) throw new Error(`Failed to load reconcile selection: ${error.message}`);
  if (!data) return null;
  return {
    invoice_ids: (data.invoice_ids as string[]) ?? [],
    filters: (data.filters as Record<string, unknown> | null) ?? null,
  };
}

export async function saveReconcileSelection(
  createdBy: string,
  from: string,
  to: string,
  invoiceIds: string[],
  filters?: Record<string, unknown> | null
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { period_from, period_to } = periodKey(from, to);
  const { error } = await supabase.from('hdms_reconcile_selection').upsert(
    {
      created_by: createdBy,
      period_from,
      period_to,
      invoice_ids: invoiceIds,
      filters: filters ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'created_by,period_from,period_to' }
  );
  if (error) throw new Error(`Failed to save reconcile selection: ${error.message}`);
}

export async function deleteReconcileSelection(
  createdBy: string,
  from: string,
  to: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { period_from, period_to } = periodKey(from, to);
  const { error } = await supabase
    .from('hdms_reconcile_selection')
    .delete()
    .eq('created_by', createdBy)
    .eq('period_from', period_from)
    .eq('period_to', period_to);
  if (error) throw new Error(`Failed to delete reconcile selection: ${error.message}`);
}
