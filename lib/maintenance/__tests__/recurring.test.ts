import { describe, it, expect } from 'vitest';
import { isDeferredRecurring, mondayOf } from '../recurring';

// 2026-07-17 is a Friday; its week is Mon 2026-07-13 → Sun 2026-07-19.
const TODAY = '2026-07-17';

describe('mondayOf', () => {
  it('maps every day of a week to its Monday', () => {
    expect(mondayOf('2026-07-13')).toBe('2026-07-13'); // Monday
    expect(mondayOf('2026-07-17')).toBe('2026-07-13'); // Friday
    expect(mondayOf('2026-07-19')).toBe('2026-07-13'); // Sunday
    expect(mondayOf('2026-07-20')).toBe('2026-07-20'); // next Monday
  });

  it('handles timestamps by using the date part', () => {
    expect(mondayOf('2026-07-17T19:00:00Z')).toBe('2026-07-13');
  });
});

describe('isDeferredRecurring', () => {
  const recurring = (scheduled: string | null) => ({
    appfolio_recurring: true,
    scheduled_start: scheduled,
  });

  it('defers a recurring WO scheduled in a future week', () => {
    expect(isDeferredRecurring(recurring('2026-07-20'), TODAY)).toBe(true); // next Mon
    expect(isDeferredRecurring(recurring('2026-08-14'), TODAY)).toBe(true); // next month
  });

  it('shows a recurring WO once its due week arrives', () => {
    expect(isDeferredRecurring(recurring('2026-07-17'), TODAY)).toBe(false); // today
    expect(isDeferredRecurring(recurring('2026-07-19'), TODAY)).toBe(false); // Sunday same week
    expect(isDeferredRecurring(recurring('2026-07-13'), TODAY)).toBe(false); // Monday same week
  });

  it('keeps overdue recurring WOs visible', () => {
    expect(isDeferredRecurring(recurring('2026-07-01'), TODAY)).toBe(false);
  });

  it('never defers non-recurring or unscheduled WOs', () => {
    expect(
      isDeferredRecurring({ appfolio_recurring: false, scheduled_start: '2026-09-01' }, TODAY)
    ).toBe(false);
    expect(
      isDeferredRecurring({ appfolio_recurring: null, scheduled_start: '2026-09-01' }, TODAY)
    ).toBe(false);
    expect(isDeferredRecurring(recurring(null), TODAY)).toBe(false);
  });
});
