import { describe, expect, it } from 'vitest';
import { MAX_RISK_NOTE_CHARS, RISK_NOTE_AUTHORS, canWriteRiskNote, parseRiskNoteInput } from '../risk-notes';
import { checkPath } from '@/lib/access/sections';

describe('fee change risk notes', () => {
  it('lets Matt and Penny (and Craig, to test) write notes', () => {
    for (const e of ['matt@highdesertpm.com', 'penny@highdesertpm.com', 'craig@highdesertpm.com', ' Matt@HighDesertPM.com ']) {
      expect(canWriteRiskNote(e), e).toBe(true);
    }
  });
  it('keeps everyone else read-only', () => {
    for (const e of ['lisa@highdesertpm.com', '', null, undefined]) expect(canWriteRiskNote(e), String(e)).toBe(false);
  });
  it('always shows Matt and Penny as the note fields', () => {
    expect(RISK_NOTE_AUTHORS.filter((a) => a.primary).map((a) => a.name)).toEqual(['Matt', 'Penny']);
  });

  it('accepts a note for an owner set and trims it', () => {
    expect(parseRiskNoteInput({ ownerSetKey: '12+34', ownerName: ' Smith Trust ', note: '  Call Bob first.  ' })).toEqual({
      ownerSetKey: '12+34',
      ownerName: 'Smith Trust',
      note: 'Call Bob first.',
    });
  });
  it('treats an empty note as clearing it', () => {
    expect(parseRiskNoteInput({ ownerSetKey: '12', note: '   ' })?.note).toBe('');
  });
  it('rejects a missing owner, non-text or too-long note', () => {
    expect(parseRiskNoteInput({ note: 'x' })).toBeNull();
    expect(parseRiskNoteInput({ ownerSetKey: '12', note: 5 })).toBeNull();
    expect(parseRiskNoteInput({ ownerSetKey: '12', note: 'x'.repeat(MAX_RISK_NOTE_CHARS + 1) })).toBeNull();
    expect(parseRiskNoteInput(null)).toBeNull();
  });
});

describe('fee change risk access', () => {
  it('serves the Knowledge Capture copy under its own section, not Fee Management', () => {
    expect(checkPath('/api/knowledge-capture/fee-risk', ['fee_management']).allowed).toBe(true);
    expect(checkPath('/api/knowledge-capture/fee-risk', ['knowledge_capture']).allowed).toBe(false);
  });
  it('keeps the Fee Management note route behind Fee Management', () => {
    expect(checkPath('/api/admin/fee-management/risk-notes', ['fee_management']).allowed).toBe(false);
  });
});
