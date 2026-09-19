import { describe, expect, it } from 'vitest';
import { estimateStage } from '../estimate-queue';

describe('estimate queue stages', () => {
  it('keeps an unissued header in drafts', () => {
    expect(estimateStage('draft', false, false, 0, 0)).toBe('draft');
  });
  it('separates pending approval from approved unstarted work', () => {
    expect(estimateStage('approval_pending', true, false, 0, 0)).toBe('approval_pending');
    expect(estimateStage('approved', true, false, 0, 0)).toBe('approved');
  });
  it('keeps partially drafted scope visible in approved work', () => {
    expect(estimateStage('approved', true, false, 4, 1)).toBe('approved');
  });
  it('moves fully reserved or converted scope into billing', () => {
    expect(estimateStage('approved', true, false, 4, 4)).toBe('billing');
    expect(estimateStage('approved', true, true, 0, 0)).toBe('billing');
  });
  it('does not treat voided or declined scope as awaiting approval', () => {
    expect(estimateStage('void', true, false, 0, 0)).toBe('closed');
    expect(estimateStage('declined', true, false, 0, 0)).toBe('closed');
  });
});
