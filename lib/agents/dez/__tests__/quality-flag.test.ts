import { describe, it, expect } from 'vitest';
import type { Source } from '@/lib/rag';
import { looksLikeFormRequest, assessFormSources } from '@/lib/agents/dez/quality-flag';

const src = (title: string, over: Partial<Source> = {}): Source => ({
  id: title,
  title,
  url: 'https://hdpm.sharepoint.com/x',
  type: 'onedrive_doc',
  icon: '🗂️',
  section: null,
  ...over,
});

describe('looksLikeFormRequest', () => {
  it('true when the asker wants an actual form/document', () => {
    expect(looksLikeFormRequest('do we have a move-in form?')).toBe(true);
    expect(looksLikeFormRequest('send me the deposit to hold agreement')).toBe(true);
    expect(looksLikeFormRequest('what is the latest lease addendum')).toBe(true);
  });
  it('false for a policy/how-to question', () => {
    expect(looksLikeFormRequest('what is the security deposit return timeline?')).toBe(false);
    expect(looksLikeFormRequest('how many notices went out this week?')).toBe(false);
  });
});

describe('assessFormSources', () => {
  const branded = src('Tenant Forms / HDPM Branded (Redesigned) / RF - Deposit to Hold (Branded).pdf');
  const older = src('Tenant Forms / Forms - Tenant Move-In / RF - DEPOSIT TO HOLD AGREEMENT.docx');
  const sop = src('Procedures / SOP - Move-Out Process.pdf'); // not a form folder
  const ors = src('ORS 90.300', { type: 'ors_90' });

  it('no form sources → no flag', () => {
    const f = assessFormSources([sop, ors]);
    expect(f.caveat).toBeNull();
    expect(f.needsAttention).toBe(false);
  });

  it('only an older/unbranded form → escalate to Craig', () => {
    const f = assessFormSources([older, ors]);
    expect(f.needsAttention).toBe(true);
    expect(f.caveat).toMatch(/Craig/);
    expect(f.flaggedTitle).toBe(older.title);
  });

  it('branded + older present → point to the branded one, no escalation', () => {
    const f = assessFormSources([older, branded]);
    expect(f.needsAttention).toBe(false);
    expect(f.caveat).toMatch(/branded/i);
    expect(f.flaggedTitle).toBe(branded.title);
  });

  it('only a branded form → light confirm note, no escalation', () => {
    const f = assessFormSources([branded]);
    expect(f.needsAttention).toBe(false);
    expect(f.caveat).toMatch(/confirm/i);
  });
});
