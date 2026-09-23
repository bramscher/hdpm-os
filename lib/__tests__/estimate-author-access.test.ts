import { describe, expect, it, vi } from 'vitest';
import { canAuthorEstimates, canIssueEstimates } from '@/lib/turn-estimator/access';
const m=vi.hoisted(()=>({role:'staff',email:'alberto@highdesertpm.com'}));
vi.mock('@/lib/staff-capabilities-server',()=>({loadStaffCapabilities:async()=>({'estimate.draft':canAuthorEstimates(m.role,m.email),'estimate.template':canAuthorEstimates(m.role,m.email),'estimate.issue':canIssueEstimates(m.role),'invoice.draft':false,'invoice.generate':false})}));
vi.mock('@/lib/require-role',()=>({requireCompanySession:async()=>({ok:true,...m})}));
import { requireEstimateAuthor } from '@/lib/require-estimate-author';
describe('estimate author access',()=>{
 it.each(['alberto','brody','cheryl'])('allows %s to draft without office issue authority',async name=>{
  m.email=name+'@highdesertpm.com';m.role='staff';
  expect(canAuthorEstimates(m.role,m.email)).toBe(true);
  expect((await requireEstimateAuthor()).ok).toBe(true);
  expect(canIssueEstimates(m.role)).toBe(false);
 });
 it('denies unrelated staff and permits finance only for reading',async()=>{
  m.email='other@highdesertpm.com';m.role='staff';expect((await requireEstimateAuthor()).ok).toBe(false);
  m.role='finance';expect((await requireEstimateAuthor()).ok).toBe(false);expect((await requireEstimateAuthor(true)).ok).toBe(true);
 });
 it('retains office creation and issuing',()=>{for(const role of ['admin','maintenance','pm','manager']){expect(canAuthorEstimates(role)).toBe(true);expect(canIssueEstimates(role)).toBe(true);}});
});
