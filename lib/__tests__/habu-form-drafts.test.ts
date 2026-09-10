import { describe, expect, it, vi } from 'vitest';
import { FORM_DRAFTS, draftMarkdown, initialDraftValues } from '@/lib/habu-paper/form-drafts';

describe('HABU form drafts', () => {
  it('covers all 15 photographed forms with unique editable fields and source notes', () => {
    expect(FORM_DRAFTS).toHaveLength(15);
    expect(new Set(FORM_DRAFTS.map(f => f.id)).size).toBe(15);
    for (const form of FORM_DRAFTS) {
      const fields = form.sections.flatMap(s => s.fields);
      expect(new Set(fields.map(f => f.id)).size, form.id).toBe(fields.length);
      expect(form.source).toBeTruthy();
      expect(form.review.length).toBeGreaterThan(0);
    }
  });
  it('exports current edits and draft warnings without changing another form', () => {
    const first = FORM_DRAFTS.find(f => f.id === 'co-tenant-setup')!;
    const other = FORM_DRAFTS.find(f => f.id === 'acquired-tenant-setup')!;
    const values = initialDraftValues(first);
    values.address = 'Fictional review address'; values['ct-setup-0'] = 'checked';
    const output = draftMarkdown(first, values);
    expect(output).toContain('Fictional review address');
    expect(output).toContain('- [x] Sent email for request to add');
    expect(output).toContain('DRAFT — for internal review');
    expect(initialDraftValues(other).address).toBe('');
    expect(initialDraftValues(first).address).toBe('');
  });
  it('includes recovered agreement wording and marks its source review status', () => {
    const form = FORM_DRAFTS.find(f => f.id === 'deposit-to-hold')!;
    const output = draftMarkdown(form, initialDraftValues(form));
    expect(output).toContain('Complete disclosure, fee and agreement wording recovered');
    expect(output).toContain('First Class Mail');
    expect(output).toContain('General/Tenant Forms/');
    expect(output).toContain('Agreement text');
  });
  it('includes the second inspection page and correct information-form capacities', () => {
    const inspection = FORM_DRAFTS.find(f => f.id === 'move-in-condition')!;
    expect(inspection.sections.map(s => s.title)).toEqual(expect.arrayContaining(['Dining room', 'Master bedroom', 'Bedroom 1', 'Bedroom 2', 'Master bath', 'Bathroom 1', 'Bathroom 2']));
    expect(inspection.sections.flatMap(s => s.fields).some(f => f.id === 'propane')).toBe(true);
    expect(FORM_DRAFTS.find(f => f.id === 'household-supplement')!.sections.filter(s => s.title.startsWith('Applicant'))).toHaveLength(4);
    expect(FORM_DRAFTS.find(f => f.id === 'tenant-information')!.sections.filter(s => s.title.startsWith('Vehicle'))).toHaveLength(5);
  });
});

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/app/admin/habu-paper/forms/form-draft-library', () => ({ default: () => null }));
import { auth } from '@/lib/auth';
import FormDraftsPage from '@/app/admin/habu-paper/forms/page';
describe('form library server access', () => {
  it.each([null, { user: { email: 'someone@highdesertpm.com', role: 'admin' } }, { user: { email: 'craig@highdesertpm.com', role: 'staff' } }])('rejects non-owner sessions', async session => {
    vi.mocked(auth).mockResolvedValue(session as never);
    await expect(FormDraftsPage()).rejects.toThrow('NOT_FOUND');
  });
  it('allows the owner with admin access', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { email: 'craig@highdesertpm.com', role: 'admin' } } as never);
    expect(await FormDraftsPage()).toBeTruthy();
  });
});
