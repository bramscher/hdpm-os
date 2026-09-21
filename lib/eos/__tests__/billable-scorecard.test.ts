import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({from:vi.fn(),invoices:[] as any[],previous:[] as any[],writes:[] as any[]}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:mocks.from})}));vi.mock('@/lib/audit',()=>({logAudit:vi.fn()}));
import {reconcileBillableScorecard} from '../billable-scorecard';
const metric={id:'a',name:'Alberto hours',source:'metrics_snapshot',source_ref:'billable_hours.albertoHours',goal_op:'gte',goal_value:30} as any;
beforeEach(()=>{mocks.invoices=[{status:'generated',doc_type:'invoice',completed_date:'2026-06-05',line_items:[{type:'labor',qty:8,technician:'alberto'}]}];mocks.previous=[];mocks.writes=[];mocks.from.mockImplementation((table:string)=>{const q:any={};for(const method of ['select','order','range','in','gte','limit'])q[method]=()=>q;q.upsert=(row:any)=>{mocks.writes.push(row);return {error:null}};q.then=(resolve:any)=>Promise.resolve({data:table==='hdms_invoices'?mocks.invoices:mocks.previous,error:null}).then(resolve);return q;});});
describe('invoice scorecard reconciliation',()=>{
 it('reconstructs June from invoice records and leaves absent historical weeks blank',async()=>{await reconcileBillableScorecard([metric],new Date('2026-09-21T19:00:00Z'));expect(mocks.writes.map(r=>[r.week_start,r.value])).toEqual([['2026-06-01',8],['2026-09-21',0]]);});
 it('corrects later-entered invoice hours but preserves manual entries',async()=>{mocks.previous=[{metric_id:'a',week_start:'2026-06-01',value:1,source:'auto'},{metric_id:'a',week_start:'2026-09-21',value:3,source:'manual'}];await reconcileBillableScorecard([metric],new Date('2026-09-21T19:00:00Z'));expect(mocks.writes).toHaveLength(1);expect(mocks.writes[0].value).toBe(8);});
 it('marks unattributed labor as incomplete instead of a false zero',async()=>{mocks.invoices[0].line_items[0].technician=undefined;await reconcileBillableScorecard([metric],new Date('2026-09-21T19:00:00Z'));expect(mocks.writes[0]).toMatchObject({week_start:'2026-06-01',value:null,on_track:null});});
 it('does not write in dry run',async()=>{await reconcileBillableScorecard([metric],new Date('2026-09-21T19:00:00Z'),true);expect(mocks.writes).toEqual([]);});
});
