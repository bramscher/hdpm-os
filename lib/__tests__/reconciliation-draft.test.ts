import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {newReconciliationDraft,validReconciliationDraft} from '../reconciliation-draft';
import {GET,PUT,DELETE} from '../../app/api/reconciliation-draft/route';
const mock=vi.hoisted(()=>({email:'craig@highdesertpm.com',rows:new Map<string,any>()}));
vi.mock('../auth',()=>({auth:async()=>({user:{email:mock.email}})}));
vi.mock('../supabase',()=>({getSupabaseAdmin:()=>({from:()=>{
  let action='read',values:any,filters:Record<string,string>={};
  function execute(){
    const key=values?.created_by||filters.created_by;
    const row=mock.rows.get(key);
    const match=row&&(!filters['filters->>revision']||row.filters.revision===filters['filters->>revision']);
    if(action==='insert'){
      if(row)return {data:null,error:{code:'23505'}};
      mock.rows.set(key,{...values,updated_at:'2026-09-23T20:00:00Z'});
    }else if(action==='update'){
      if(!match)return {data:null,error:null};
      mock.rows.set(key,{...row,...values,updated_at:'2026-09-23T20:01:00Z'});
    }else if(action==='delete'){
      if(!match)return {data:[],error:null};mock.rows.delete(key);return {data:[{id:'row'}],error:null};
    }
    return {data:mock.rows.get(key)||null,error:null};
  }
  const q:any={select:()=>q,eq:(k:string,v:string)=>{filters[k]=v;return q;},insert:(v:any)=>{action='insert';values=v;return q;},update:(v:any)=>{action='update';values=v;return q;},delete:()=>{action='delete';return q;},maybeSingle:async()=>execute(),then:(resolve:any)=>Promise.resolve(execute()).then(resolve)};
  return q;
}})}));
function req(method:string,body?:unknown,revision?:string){return new NextRequest(`https://example.com/api/reconciliation-draft${revision?'?revision='+revision:''}`,{method,...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(()=>{mock.email='craig@highdesertpm.com';mock.rows.clear();});
describe('Saved reconciliation',()=>{
  it('round-trips dates, selected invoices, filters and unfinished payment details',async()=>{
    const draft=newReconciliationDraft();draft.list.dateFrom='2026-09-01';draft.list.dateTo='2026-09-15';draft.list.invoiceIds=['one','two'];draft.list.search='unit';
    draft.payment={mode:'new',selectedPaymentId:'',payee:'HDMS',paidOn:'2026-09-23',amount:'123.45',reference:'ACH-123',method:'ach',memo:'Check credit first'};
    expect((await PUT(req('PUT',{draft,revision:null}))).status).toBe(200);
    expect((await (await GET()).json()).draft).toEqual(draft);
  });
  it('keeps the timestamped draft after payment recording',async()=>{
    const draft=newReconciliationDraft();const first=await (await PUT(req('PUT',{draft,revision:null}))).json();
    draft.recordedAt=new Date().toISOString();await PUT(req('PUT',{draft,revision:first.revision}));
    const saved=await (await GET()).json();expect(saved.draft.id).toBe(draft.id);expect(saved.draft.createdAt).toBe(draft.createdAt);expect(saved.draft.recordedAt).toBeTruthy();
  });
  it('replaces only the current user draft when a new reconciliation is started',async()=>{
    const first=await (await PUT(req('PUT',{draft:newReconciliationDraft(),revision:null}))).json();
    const next=newReconciliationDraft();expect((await PUT(req('PUT',{draft:next,revision:first.revision}))).status).toBe(200);
    expect((await (await GET()).json()).draft.id).toBe(next.id);
    mock.email='penny@highdesertpm.com';expect((await (await GET()).json()).draft).toBeNull();
  });
  it('rejects stale saves and stale deletes from another tab',async()=>{
    const draft=newReconciliationDraft();const first=await (await PUT(req('PUT',{draft,revision:null}))).json();
    const second=await (await PUT(req('PUT',{draft,revision:first.revision}))).json();
    expect((await PUT(req('PUT',{draft,revision:first.revision}))).status).toBe(409);
    expect((await PUT(req('PUT',{draft,revision:null}))).status).toBe(409);
    expect((await DELETE(req('DELETE',undefined,first.revision))).status).toBe(409);
    expect((await DELETE(req('DELETE',undefined,second.revision))).status).toBe(200);
    expect((await (await GET()).json()).draft).toBeNull();
  });
  it('does not allow another user to delete or overwrite the draft',async()=>{
    const first=await (await PUT(req('PUT',{draft:newReconciliationDraft(),revision:null}))).json();mock.email='penny@highdesertpm.com';
    expect((await DELETE(req('DELETE',undefined,first.revision))).status).toBe(409);
    expect((await PUT(req('PUT',{draft:newReconciliationDraft(),revision:first.revision}))).status).toBe(409);
    expect(mock.rows.size).toBe(1);
  });
  it('rejects anonymous and external callers',async()=>{
    mock.email='person@example.com';expect((await GET()).status).toBe(401);expect((await PUT(req('PUT',{}))).status).toBe(401);expect((await DELETE(req('DELETE'))).status).toBe(401);
  });
  it('rejects malformed saved state',async()=>{
    expect(validReconciliationDraft(newReconciliationDraft())).toBe(true);
    for(const draft of [{},null,{...newReconciliationDraft(),list:{invoiceIds:'bad'}},{...newReconciliationDraft(),payment:{amount:20}}]){
      expect((await PUT(req('PUT',{draft,revision:null}))).status).toBe(400);
    }
  });
});
