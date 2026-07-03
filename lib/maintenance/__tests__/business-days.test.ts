import { describe, it, expect } from 'vitest';
import {
  businessDaysBetween,
  daysBetween,
  isBusinessDay,
  nextBusinessDay,
  toDateString,
} from '../business-days';

// 2026-07-02 = Thursday, 2026-07-03 = Friday, 2026-07-04/05 = weekend, 2026-07-06 = Monday
const thu = new Date('2026-07-02T12:00:00Z');
const fri = new Date('2026-07-03T12:00:00Z');
const sat = new Date('2026-07-04T12:00:00Z');
const mon = new Date('2026-07-06T12:00:00Z');

describe('isBusinessDay', () => {
  it('weekdays yes, weekend no', () => {
    expect(isBusinessDay(thu)).toBe(true);
    expect(isBusinessDay(fri)).toBe(true);
    expect(isBusinessDay(sat)).toBe(false);
    expect(isBusinessDay(new Date('2026-07-05T12:00:00Z'))).toBe(false);
  });
});

describe('nextBusinessDay', () => {
  it('Thursday → Friday', () => {
    expect(toDateString(nextBusinessDay(thu))).toBe('2026-07-03');
  });
  it('Friday → Monday', () => {
    expect(toDateString(nextBusinessDay(fri))).toBe('2026-07-06');
  });
  it('Saturday → Monday', () => {
    expect(toDateString(nextBusinessDay(sat))).toBe('2026-07-06');
  });
});

describe('businessDaysBetween', () => {
  it('same day = 0', () => {
    expect(businessDaysBetween(thu, thu)).toBe(0);
  });
  it('Thu → Fri = 1', () => {
    expect(businessDaysBetween(thu, fri)).toBe(1);
  });
  it('Fri → Mon = 1 (weekend skipped)', () => {
    expect(businessDaysBetween(fri, mon)).toBe(1);
  });
  it('Thu → next Thu = 5', () => {
    expect(businessDaysBetween(thu, new Date('2026-07-09T12:00:00Z'))).toBe(5);
  });
  it('end before start = 0', () => {
    expect(businessDaysBetween(mon, thu)).toBe(0);
  });
});

describe('daysBetween', () => {
  it('floors whole days', () => {
    expect(daysBetween(thu, new Date('2026-07-04T11:00:00Z'))).toBe(1);
    expect(daysBetween(thu, new Date('2026-07-04T13:00:00Z'))).toBe(2);
  });
  it('never negative', () => {
    expect(daysBetween(mon, thu)).toBe(0);
  });
});
