import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { canEditInvoiceDraft, invoiceDraftFields, canCreateInvoices, canGenerateInvoice } from '@/lib/invoice-permissions';

const mocks = vi.hoisted(() => ({
  role: 'field', email: 'alberto@highdesertpm.com',
  create: vi.fn(), credit: vi.fn(), get: vi.fn(), update: vi.fn(), remove: vi.fn(),
}));
vi.mock('@/lib/require-role', () => ({
  requireCompanySession: async () => mocks.email.endsWith('@highdesertpm.com') ? {ok:true,role:mocks.role,email:mocks.email} : {ok:false,response:new Response('Unauthorized',{status:401})},
  requireRole: async (...roles: string[]) => mocks.role === 'admin' || roles.includes(mocks.role)
    ? { ok: true, role: mocks.role, email: mocks.email }
    : { ok: false, response: new Response('Forbidden', { status: 403 }) },
}));
vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: mocks.email } }) }));
vi.mock('@/lib/invoices', () => ({
  createInvoice: mocks.create, createCredit: mocks.credit, getInvoiceById: mocks.get,
  updateInvoice: mocks.update, deleteInvoice: mocks.remove, getInvoices: vi.fn(),
  uploadInvoicePdf: vi.fn(async()=> 'saved.pdf'), duplicateInvoice: vi.fn(),
}));
vi.mock('@/lib/af-bills', () => ({ attachAfBillsToInvoices: vi.fn() }));
vi.mock('@/lib/invoice-pdf-template', () => ({ generateInvoicePdf: vi.fn() }));
import { POST } from '@/app/api/invoices/route';
import { PATCH, DELETE } from '@/app/api/invoices/[id]/route';
import { POST as generatePdf } from '@/app/api/invoices/[id]/generate-pdf/route';
import { PATCH as changeStatus } from '@/app/api/invoices/[id]/status/route';
import { POST as duplicate } from '@/app/api/invoices/[id]/duplicate/route';

const params = { params: Promise.resolve({ id: 'draft-1' }) };
const request = (body: object, method = 'POST') => new NextRequest('http://localhost/api/invoices', { method, body: JSON.stringify(body) });
const draft = { id: 'draft-1', status: 'draft', doc_type: 'invoice', created_by: 'alberto@highdesertpm.com', maintenance_job_id: null };
const input = { property_name: 'Pilot', property_address: 'Test address', description: 'Completed repair', labor_amount: 95, materials_amount: 0 };

beforeEach(() => {
  vi.clearAllMocks(); mocks.role = 'field'; mocks.email = 'alberto@highdesertpm.com';
  mocks.get.mockResolvedValue(draft); mocks.create.mockResolvedValue(draft); mocks.update.mockResolvedValue(draft);
});

describe('field invoice preparation', () => {
  it('creates an invoice draft without an estimate and stamps the authenticated author', async () => {
    const response = await POST(request({ ...input, created_by: 'craig@highdesertpm.com', status: 'generated', pdf_path: 'fake', maintenance_job_id: 'fake' }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ created_by: mocks.email }));
    const written = mocks.create.mock.calls[0][0];
    expect(written).not.toHaveProperty('status'); expect(written).not.toHaveProperty('pdf_path');
    expect(written).not.toHaveProperty('maintenance_job_id');
  });
  it('rejects credits', async () => {
    expect((await POST(request({ ...input, doc_type: 'credit' }))).status).toBe(403);
    expect(mocks.credit).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it('saves own draft through an allowlist and requires ownership at write time', async () => {
    expect((await PATCH(request({ description: 'Updated work', status: 'attached', created_by: 'other', pdf_path: 'fake', doc_type: 'credit', maintenance_job_id: 'job' }, 'PATCH'), params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('draft-1', { description: 'Updated work' }, mocks.email);
  });
  it.each([
    { status: 'generated' }, { status: 'attached' }, { status: 'void' },
    { created_by: 'brody@highdesertpm.com' }, { doc_type: 'credit' }, { maintenance_job_id: 'job-1' },
  ])('rejects edits outside own ordinary drafts: %j', async override => {
    mocks.get.mockResolvedValue({ ...draft, ...override });
    expect((await PATCH(request({ description: 'Changed' }, 'PATCH'), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('keeps PDF generation, status changes, deletion and duplication office-only', async () => {
    expect((await generatePdf(request({}), params)).status).toBe(403);
    expect((await changeStatus(request({ status: 'generated' }, 'PATCH'), params)).status).toBe(403);
    expect((await DELETE(request({}, 'DELETE'), params)).status).toBe(403);
    expect((await duplicate(request({}), params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(['finance', 'maintenance', 'pm', 'manager', 'admin'])('preserves office editing for %s', async role => {
    mocks.role = role; mocks.get.mockResolvedValue({ ...draft, created_by: 'other' });
    expect((await PATCH(request({ description: 'Reviewed' }, 'PATCH'), params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('draft-1', { description: 'Reviewed' });
  });
  it.each(['staff', 'read_only', 'inspector', 'front_desk'])('does not grant draft creation to %s', async role => {
    mocks.role = role;
    expect((await POST(request(input))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('compares author emails case-insensitively and denies unresolved sessions', () => {
    expect(canEditInvoiceDraft('field', 'ALBERTO@highdesertpm.com', draft as never)).toBe(true);
    expect(canEditInvoiceDraft(undefined, undefined, draft as never)).toBe(false);
    expect(invoiceDraftFields({ status: 'generated', description: 'Work' })).toEqual({ description: 'Work' });
  });
});


describe.each(['cheryl@highdesertpm.com', 'penny@highdesertpm.com'])('Appliance invoice access for %s', email => {
  beforeEach(() => { mocks.role='staff'; mocks.email=email; mocks.get.mockResolvedValue({...draft,created_by:mocks.email}); });
  it('creates appliance invoices with the authenticated author', async()=>{
    const items=[{type:'appliance',description:'Refrigerator',qty:1,cost:500,markup_pct:10,amount:550}];
    expect((await POST(request({...input,line_items:items,labor_amount:0,materials_amount:550,total_amount:550}))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({created_by:mocks.email,line_items:items,total_amount:550}));
  });
  it('edits and generates her own ordinary drafts',async()=>{
    expect((await PATCH(request({description:'New refrigerator'},'PATCH'),params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('draft-1',{description:'New refrigerator'},mocks.email);
    expect((await generatePdf(request({}),params)).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith('draft-1',{pdf_path:'saved.pdf',status:'generated'},mocks.email);
  });
  it('cannot edit or generate another author’s invoice',async()=>{
    mocks.get.mockResolvedValue(draft);
    expect((await PATCH(request({description:'Changed'},'PATCH'),params)).status).toBe(403);
    expect((await generatePdf(request({}),params)).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('does not gain credits, deletion, duplication, or arbitrary status changes',async()=>{
    expect((await POST(request({...input,doc_type:'credit'}))).status).toBe(403);
    expect((await DELETE(request({},'DELETE'),params)).status).toBe(403);
    expect((await duplicate(request({}),params)).status).toBe(403);
    expect((await changeStatus(request({status:'attached'},'PATCH'),params)).status).toBe(403);
  });
  it('limits the permission to approved staff accounts',()=>{
    expect(canCreateInvoices('staff',email.toUpperCase())).toBe(true);
    expect(canCreateInvoices('staff','other@highdesertpm.com')).toBe(false);
    expect(canGenerateInvoice('staff','cheryl@example.com')).toBe(false);
    expect(canGenerateInvoice('read_only','cheryl@highdesertpm.com')).toBe(false);
  });
});

it('preserves Craig’s full invoice access as admin', () => {
  expect(canCreateInvoices('admin', 'craig@highdesertpm.com')).toBe(true);
  expect(canGenerateInvoice('admin', 'craig@highdesertpm.com', draft as never)).toBe(true);
  expect(canEditInvoiceDraft('admin', 'craig@highdesertpm.com', draft as never)).toBe(true);
});
