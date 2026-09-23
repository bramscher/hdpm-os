import { describe, it, expect } from 'vitest';
import { effectiveCapabilities, roleCapabilities } from '@/lib/staff-capabilities';
import { canCreateInvoices, canEditInvoiceDraft, canGenerateInvoice } from '@/lib/invoice-permissions';
import { canAuthorEstimates } from '@/lib/turn-estimator/access';
describe('staff capability overrides',()=>{
 it('explicit off beats role defaults and previous named access',()=>{const c=effectiveCapabilities('maintenance',true,{'invoice.draft':false,'estimate.draft':false});expect(canCreateInvoices('maintenance','alberto@highdesertpm.com',c)).toBe(false);expect(canAuthorEstimates('maintenance','cheryl@highdesertpm.com',c)).toBe(false);expect(c['estimate.template']).toBe(false);expect(c['estimate.issue']).toBe(false);expect(c['invoice.generate']).toBe(false);});
 it('grants shared invoice editing without office access',()=>{const c=effectiveCapabilities('staff',true,{'invoice.draft':true});const draft={status:'draft',doc_type:'invoice',created_by:'new@highdesertpm.com',maintenance_job_id:null} as const;expect(canEditInvoiceDraft('staff','new@highdesertpm.com',draft,c)).toBe(true);expect(canEditInvoiceDraft('staff','other@highdesertpm.com',draft,c)).toBe(true);expect(canGenerateInvoice('staff','new@highdesertpm.com',draft,c)).toBe(false);});
 it('allows PDF generation only when both permissions are enabled',()=>{const c=effectiveCapabilities('staff',true,{'invoice.draft':true,'invoice.generate':true});expect(canGenerateInvoice('staff','new@highdesertpm.com',undefined,c)).toBe(true);expect(canGenerateInvoice('staff','new@highdesertpm.com',{status:'draft',doc_type:'invoice',created_by:'other',maintenance_job_id:null},c)).toBe(true);});
 it('denies inactive staff and keeps admins recoverable',()=>{expect(Object.values(effectiveCapabilities('admin',false,{})).every(v=>!v)).toBe(true);expect(Object.values(effectiveCapabilities('admin',true,{'invoice.draft':false})).every(Boolean)).toBe(true);});
 it('default removes the override and restores role behavior',()=>{expect(effectiveCapabilities('staff',true,{})).toEqual(roleCapabilities('staff'));});
});


describe('invoice editing toggle', () => {
 it.each(['Brody', 'Penny', 'Cheryl', 'Alberto', 'Ashley', 'Kennedy', 'Matt'])('allows %s to edit shared invoices without PDF permission', name => {
   const c=effectiveCapabilities('staff',true,{'invoice.draft':true,'invoice.generate':false});
   for (const status of ['draft','generated','attached'] as const) {
     const invoice={status,doc_type:'invoice' as const,created_by:'someoneelse@highdesertpm.com',maintenance_job_id:null};
     expect(canEditInvoiceDraft('staff',name.toLowerCase()+'@highdesertpm.com',invoice,c)).toBe(true);
     expect(canGenerateInvoice('staff',name.toLowerCase()+'@highdesertpm.com',invoice,c)).toBe(false);
   }
 });
 it.each(['staff','maintenance','finance'])('Off removes editing and PDF access for %s', role => {
   const c=effectiveCapabilities(role,true,{'invoice.draft':false,'invoice.generate':true});
   const invoice={status:'generated' as const,doc_type:'invoice' as const,created_by:'other',maintenance_job_id:null};
   expect(canEditInvoiceDraft(role,'brody@highdesertpm.com',invoice,c)).toBe(false);
   expect(canGenerateInvoice(role,'brody@highdesertpm.com',invoice,c)).toBe(false);
 });
});
