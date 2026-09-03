import { listPriceBookItems } from '@/lib/turn-estimator/price-book';
import { getWorkOrderById } from '@/lib/work-orders';
import { getSupabaseAdmin } from '@/lib/supabase';
import EstimateBuilder, { type BuilderSeed } from '@/components/turn-estimator/EstimateBuilder';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — New Estimate' };

/**
 * /turn-estimator/estimates/new — the estimate builder. Seeds from a work order
 * (?from_wo=) or a turn (?turn=): property/unit/turn come from AppFolio (the WO
 * system of record). Staff add price-book line items, issue, get approval, and
 * convert to an invoice — all from here.
 */
export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ from_wo?: string; turn?: string }>;
}) {
  const { from_wo, turn } = await searchParams;
  const items = await listPriceBookItems();

  let seed: BuilderSeed = {};
  if (from_wo) {
    const wo = await getWorkOrderById(from_wo);
    if (wo) {
      seed = {
        property_name: wo.property_name,
        property_id: wo.property_id,
        unit_id: wo.unit_id,
        unit_name: wo.unit_name,
        unit_turn_id: wo.unit_turn_id,
        wo_number: wo.wo_number,
        wo_description: wo.description,
      };
    }
  } else if (turn) {
    const { data } = await getSupabaseAdmin()
      .from('unit_turn')
      .select('id, property_id, property_name, unit_id, unit_name')
      .eq('id', turn)
      .maybeSingle();
    if (data) {
      seed = {
        property_name: data.property_name as string,
        property_id: data.property_id as string | null,
        unit_id: data.unit_id as string | null,
        unit_name: data.unit_name as string | null,
        unit_turn_id: data.id as string,
      };
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-display text-charcoal-900">New Estimate</h1>
      <p className="mb-6 mt-1 text-sm text-charcoal-500">
        {seed.wo_number
          ? `Seeded from work order ${seed.wo_number}. `
          : ''}
        Add price-book line items, issue the estimate, get approval, then convert it to an HDMS invoice.
      </p>
      <EstimateBuilder items={items} seed={seed} />
    </div>
  );
}
