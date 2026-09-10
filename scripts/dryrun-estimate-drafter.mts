/**
 * Read-only dry run of the estimate-drafter agent against a real prod work order.
 * Loads WO text → calls claude-opus-4-8 → prices the selections deterministically.
 * Persists NOTHING (no agent_proposal, no estimate). Prints the priced draft.
 *
 *   npx tsx scripts/dryrun-estimate-drafter.mts [work_order_id]
 * With no id, picks a recent HDMS work order that has a real description.
 */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const { getSupabaseAdmin } = await import('../lib/supabase.ts');
const { getWorkOrderById } = await import('../lib/work-orders.ts');
const { fetchWorkOrderDetails } = await import('../lib/appfolio.ts');
const { listEvents } = await import('../lib/maintenance/events.ts');
const { listPriceBookItems } = await import('../lib/turn-estimator/price-book.ts');
const { getEstimatorConfig } = await import('../lib/turn-estimator/config.ts');
const { priceBookMenu, priceDraftLines } = await import('../lib/agents/estimate-drafter.ts');
const { buildDrafterInput, callDraftModel } = await import('../lib/agents/estimate-drafter-run.ts');

const sb = getSupabaseAdmin();
let woId = process.argv[2];
if (!woId) {
  const { data } = await sb
    .from('work_orders')
    .select('id, wo_number, description')
    .ilike('vendor_name', '%high desert maintenance%')
    .not('description', 'is', null)
    .order('completed_date', { ascending: false, nullsFirst: false })
    .limit(30);
  const pick = (data ?? []).find((w: any) => (w.description ?? '').replace(/tenant expense/i, '').trim().length > 30);
  woId = pick?.id;
  console.log(`(auto-picked WO ${pick?.wo_number})`);
}
if (!woId) throw new Error('no work order id');

const wo = await getWorkOrderById(woId);
if (!wo) throw new Error('WO not found');
console.log(`\nWO ${wo.wo_number} — ${wo.property_name}${wo.unit_name ? ' #' + wo.unit_name : ''}`);
console.log(`Description: ${(wo.description ?? '').replace(/\s+/g, ' ').slice(0, 160)}\n`);

const [appfolio, events, priceBook, cfg] = await Promise.all([
  wo.appfolio_id ? fetchWorkOrderDetails(wo.appfolio_id).catch(() => null) : Promise.resolve(null),
  listEvents(woId).catch(() => []),
  listPriceBookItems(),
  getEstimatorConfig(),
]);

const t = Date.now();
const result = await callDraftModel(buildDrafterInput(wo, appfolio, events, priceBookMenu(priceBook)));
console.log(`model returned in ${Math.round((Date.now() - t) / 1000)}s — ${result.lines?.length ?? 0} lines\n`);
console.log('Summary:', result.summary, '\n');

const priced = priceDraftLines(result.lines ?? [], priceBook, cfg);
for (const l of priced.lines) {
  console.log(`  ${l.item_code.padEnd(14)} qty ${String(l.qty).padEnd(4)} owner $${String(l.owner_extended).padEnd(8)} [${l.confidence}]  ${l.description.slice(0, 44)}`);
}
console.log(`\n  OWNER TOTAL: $${priced.owner_total}   internal cost: $${priced.internal_cost_total}`);
if (priced.unmapped_codes.length) console.log('  dropped codes:', priced.unmapped_codes);
if (result.unmapped_notes?.length) console.log('  unmapped notes:', result.unmapped_notes);
console.log('');
