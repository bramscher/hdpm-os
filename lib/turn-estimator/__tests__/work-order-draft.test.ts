import { describe, it, expect, vi } from 'vitest';
import { workOrderDraft } from '../work-order-draft';
import type { PriceBookItem } from '../types';
import { parseWorkOrderExtraction } from '@/lib/work-order-extraction';

const items = [
  {item_code:'LABOR_STD', pricing_method:'hourly', name:'Maintenance labor',base_price:95},
  {item_code:'MATERIALS_CP', pricing_method:'cost_plus', name:'Materials',markup_pct:25},
].map(item => ({
  id: item.item_code, org_id: 'hdpm', category: 'handyman', owner_description: null,
  internal_instructions: null, base_price: 0, included_minutes: null, increment_minutes: null,
  increment_price: null, standard_minutes: null, uom: 'each', markup_pct: null,
  markup_eligible: false, gl_code: null, tenant_alloc_eligible: false, skill_trade: null,
  market: 'central_oregon', effective_from: '2026-01-01', effective_to: null, active: true,
  created_by: null, created_at: '', updated_at: '', ...item,
})) as PriceBookItem[];

describe('invoice-style estimate drafts', () => {
  it('preserves descriptions, separates materials, and does not assume labor time or missing costs', () => {
    const result=workOrderDraft('Full source', {laborDescription:'Install and hook up range\nHaul away old range',materials:[{description:'GE 30-in 4 Burners 5.0 cu ft Electric Range White',amount:'600'},{description:'6 FT 50 Amp Range Cord',amount:'0'}]},items);
    expect(result.lines).toEqual([
      {item_code:'LABOR_STD',qty:1,minutes:0,est_material_cost:null,description:'Install and hook up range\nHaul away old range',room:null},
      {item_code:'MATERIALS_CP',qty:1,minutes:null,est_material_cost:600,description:'GE 30-in 4 Burners 5.0 cu ft Electric Range White',room:null},
      {item_code:'MATERIALS_CP',qty:1,minutes:null,est_material_cost:null,description:'6 FT 50 Amp Range Cord',room:null},
    ]);
  });
  it('preserves full scope if extraction returns no items', () => {
    expect(workOrderDraft('Repair sink and test for leaks',{laborDescription:'',materials:[]},items).lines[0].description).toBe('Repair sink and test for leaks');
  });
  it('retains scope when price-book items are missing or placeholders', () => {
    const result=workOrderDraft('Repair sink',{laborDescription:'Repair sink',materials:[]},[{...items[0],name:'Labor [PLACEHOLDER]'}]);
    expect(result.lines[0].item_code).toBe('');
    expect(result.lines[0].description).toBe('Repair sink');
    expect(result.unmapped_notes.join(' ')).toContain('Select an approved hourly');
  });
  it('does not add labor to a materials-only order or invent scope on empty orders', () => {
    expect(workOrderDraft('Cord',{laborDescription:'',materials:[{description:'Cord',amount:'15'}]},items).lines.map(l=>l.item_code)).toEqual(['MATERIALS_CP']);
    expect(workOrderDraft('',{laborDescription:'',materials:[]},items).lines).toEqual([]);
  });
  it('parses fenced extraction without shortening descriptions and rejects invalid output', () => {
    expect(parseWorkOrderExtraction('```json\n{"materials":[{"description":"Moen Adler single handle faucet","amount":"bad"}],"laborDescription":"Install faucet"}\n```')).toEqual({materials:[{description:'Moen Adler single handle faucet',amount:'0'}],laborDescription:'Install faucet'});
    expect(()=>parseWorkOrderExtraction('{"materials":[]}')).toThrow();
    expect(()=>parseWorkOrderExtraction('{"materials":[{}],"laborDescription":""}')).toThrow();
  });
});

vi.mock('@/lib/require-estimate-author',()=>({requireEstimateAuthor:vi.fn(async()=>({ok:true,email:'brody@highdesertpm.com'}))}));
vi.mock('@/lib/work-orders',()=>({getWorkOrderById:vi.fn(async()=>({description:'Repair the kitchen sink'}))}));
vi.mock('@/lib/turn-estimator/price-book',()=>({listPriceBookItems:vi.fn(async()=>items),resolvePriceBookItem:vi.fn(async(code:string)=>items.find(i=>i.item_code===code))}));
vi.mock('@/lib/work-order-extraction',async importOriginal=>({...await importOriginal<typeof import('@/lib/work-order-extraction')>(),extractWorkOrderItems:vi.fn(async()=>{throw new Error('AI unavailable');})}));

it('draft endpoint falls back to the full work-order scope if extraction fails',async()=>{
  const {POST}=await import('@/app/api/turn-estimator/estimates/draft/route');
  const {NextRequest}=await import('next/server');
  const response=await POST(new NextRequest('http://localhost/api/turn-estimator/estimates/draft',{method:'POST',body:JSON.stringify({work_order_id:'wo1'})}));
  expect(response.status).toBe(200);
  const {draft}=await response.json();
  expect(draft.lines[0].description).toBe('Repair the kitchen sink');
  expect(draft.lines[0].minutes).toBe(0);
  expect(draft.unmapped_notes[0]).toContain('full work-order text is preserved');
});

vi.mock('@/lib/turn-estimator/estimates',()=>({issueEstimateVersion:vi.fn(async()=>({estimateId:'e1'}))}));
it.each([
  {item_code:'LABOR_STD',qty:1,minutes:0},
  {item_code:'MATERIALS_CP',qty:1},
])('does not issue unfinished rough-draft pricing: $item_code',async line=>{
  const {POST}=await import('@/app/api/turn-estimator/estimates/[id]/issue/route');
  const {NextRequest}=await import('next/server');
  const response=await POST(new NextRequest('http://localhost/api/estimate/e1/issue',{method:'POST',body:JSON.stringify({lines:[line]})}),{params:Promise.resolve({id:'e1'})});
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain('before issuing');
});
it('allows issuing once labor hours and material costs are entered',async()=>{
  const {POST}=await import('@/app/api/turn-estimator/estimates/[id]/issue/route');
  const {NextRequest}=await import('next/server');
  const response=await POST(new NextRequest('http://localhost/api/estimate/e1/issue',{method:'POST',body:JSON.stringify({lines:[{item_code:'LABOR_STD',qty:1,minutes:90},{item_code:'MATERIALS_CP',qty:1,est_material_cost:20}]})}),{params:Promise.resolve({id:'e1'})});
  expect(response.status).toBe(200);
});
