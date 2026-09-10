import { describe, expect, it } from 'vitest';
import { periodKey } from '../reconcile-selection';

describe('periodKey', () => {
  it('passes through a real date range', () => {
    expect(periodKey('2026-08-01', '2026-08-31')).toEqual({
      period_from: '2026-08-01',
      period_to: '2026-08-31',
    });
  });

  it('normalizes null / undefined bounds to empty strings (open bound)', () => {
    expect(periodKey(null, undefined)).toEqual({ period_from: '', period_to: '' });
    expect(periodKey('2026-08-01', null)).toEqual({
      period_from: '2026-08-01',
      period_to: '',
    });
  });

  it('treats empty strings as the same open-bound key (stable across null vs "")', () => {
    expect(periodKey('', '')).toEqual(periodKey(null, null));
  });
});
