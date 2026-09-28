import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const state=vi.hoisted(()=>({email:'craig@highdesertpm.com',writes:[] as any[],ids:[] as string[]}));
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{email:state.email}})}));
vi.mock('@/lib/supabase',()=>({getSupabaseAdmin:()=>({from:()=>({update:(value:any)=>{state.writes.push(value);return {in:(_key:string,ids:string[])=>{state.ids=ids;return {select:async()=>({data:ids.map(id=>({id})),error:null})};}};}})})}));
const canonical='11111111-1111-4111-8111-111111111111';
const legacy='22222222-2222-4222-8222-222222222222';
vi.mock('@/lib/inspection-queue',()=>({loadInspectionQueue:async()=>({
 properties:[{id:'11111111-1111-4111-8111-111111111111',appfolio_unit_id:'unit',address_1:'1 Test St',city:'Bend',zip:'97701'}],
 rows:[{property_id:'22222222-2222-4222-8222-222222222222',inspection_properties:{id:'22222222-2222-4222-8222-222222222222',address_1:'1 Test Street',city:'Bend',zip:'97701'}}]
})}));
import {PATCH} from '@/app/api/inspections/routine-policy/route';
beforeEach(()=>{state.email='craig@highdesertpm.com';state.writes=[];state.ids=[];});
const request=(body:any)=>new NextRequest('http://localhost/api/inspections/routine-policy',{method:'PATCH',body:JSON.stringify(body)});
describe('routine policy updates',()=>{
 it.each([true,false])('sets only routine policy to %s for the unit and matched import',async enabled=>{
  const res=await PATCH(request({property_ids:[canonical],enabled}));
  expect(res.status).toBe(200);
  expect(state.ids.sort()).toEqual([canonical,legacy]);
  expect(state.writes).toEqual([{routine_inspections_enabled:enabled}]);
 });
 it('rejects invalid requests without writing',async()=>{
  expect((await PATCH(request({property_ids:[],enabled:false}))).status).toBe(400);
  expect(state.writes).toEqual([]);
 });
 it('requires a company session',async()=>{
  state.email='other@example.com';
  expect((await PATCH(request({property_ids:[canonical],enabled:false}))).status).toBe(401);
  expect(state.writes).toEqual([]);
 });
});
