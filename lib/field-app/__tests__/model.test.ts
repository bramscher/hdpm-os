import { describe, expect, it } from 'vitest';
import type { Shift } from '@/lib/timekeeping/model';
import { acceptPoints, clip, clockBody, clockSnapshot, hashDeviceToken, newDeviceToken, pacificDayBounds, pointDates, workTime } from '../model';

const shift = (over: Partial<Shift> = {}): Shift => ({ id: 's1', start: '2026-10-22T15:00:00.000Z', end: null, source: 'clocked', breaks: [], ...over });

describe('device tokens', () => {
  it('are random and only their hash is stable', () => {
    const a = newDeviceToken(), b = newDeviceToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashDeviceToken(a)).toBe(hashDeviceToken(a));
    expect(hashDeviceToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('clockSnapshot', () => {
  it('reads off, working, break and callout', () => {
    expect(clockSnapshot({ version: 4, shift: null })).toEqual({ state: 'off', version: 4, since: null });
    expect(clockSnapshot({ version: 5, shift: shift() }).state).toBe('working');
    expect(clockSnapshot({ version: 5, shift: shift({ emergencyAfterHours: true }) }).state).toBe('callout');
    const onBreak = clockSnapshot({ version: 6, shift: shift({ breaks: [{ id: 'b', start: '2026-10-22T19:00:00.000Z', end: null, minutes: 0, paid: false }] }) });
    expect(onBreak).toEqual({ state: 'onBreak', version: 6, since: '2026-10-22T19:00:00.000Z' });
  });
});

describe('clockBody', () => {
  it('maps the app actions to Timekeeping clock commands', () => {
    expect(clockBody({ action: 'in', clockVersion: 2 })).toEqual({ op: 'clock', action: 'in', clockVersion: 2 });
    expect(clockBody({ action: 'callout', clockVersion: 2 })).toEqual({ op: 'clock', action: 'in', callout: true, clockVersion: 2 });
    expect(clockBody({ action: 'break', clockVersion: 3 })).toEqual({ op: 'clock', action: 'break', paid: false, clockVersion: 3 });
    expect(clockBody({ action: 'break', paid: true, clockVersion: 3 })).toMatchObject({ paid: true });
  });
  it('rejects anything else, including a clock correction', () => {
    expect(() => clockBody({ action: 'correct', clockVersion: 1 })).toThrow('Unknown clock action');
    expect(() => clockBody({ action: 'out' })).toThrow();
    expect(() => clockBody(null)).toThrow();
  });
});

describe('workTime + acceptPoints', () => {
  const t = (iso: string) => Date.parse(iso);
  const now = t('2026-10-22T23:00:00Z');
  const time = workTime([
    shift({ end: '2026-10-22T22:00:00.000Z', breaks: [
      { id: 'b1', start: '2026-10-22T19:00:00.000Z', end: '2026-10-22T19:30:00.000Z', minutes: 30, paid: false },
      { id: 'b2', start: null, end: null, minutes: 10, paid: true },
    ] }),
    shift({ id: 'sched', source: 'scheduled', start: '2026-10-22T00:00:00.000Z', end: '2026-10-22T23:59:00.000Z' }),
  ], now);

  it('uses clocked shifts, timed breaks only, and ignores scheduled placeholders', () => {
    expect(time.windows).toEqual([{ start: t('2026-10-22T15:00:00Z'), end: t('2026-10-22T22:00:00Z') }]);
    expect(time.breaks).toEqual([{ start: t('2026-10-22T19:00:00Z'), end: t('2026-10-22T19:30:00Z') }]);
  });

  it('keeps only valid points recorded while clocked in and not on a break', () => {
    const { points, rejected } = acceptPoints([
      { t: t('2026-10-22T16:00:00Z'), lat: 44.27, lng: -121.17, acc: 8 },   // working
      { t: t('2026-10-22T19:10:00Z'), lat: 44.27, lng: -121.17, acc: 8 },   // on break
      { t: t('2026-10-22T14:00:00Z'), lat: 44.27, lng: -121.17 },           // before clock in
      { t: t('2026-10-22T16:05:00Z'), lat: 91, lng: -121.17 },              // bad latitude
      { t: 'soon', lat: 44.27, lng: -121.17 },                               // bad time
    ], time, now);
    expect(points).toEqual([{ t: t('2026-10-22T16:00:00Z'), lat: 44.27, lng: -121.17, acc: 8 }]);
    expect(rejected).toBe(4);
  });

  it('runs an open shift to now', () => {
    expect(workTime([shift()], now).windows).toEqual([{ start: t('2026-10-22T15:00:00Z'), end: now }]);
  });

  it('refuses a batch that is not a list or is too big', () => {
    expect(() => acceptPoints({}, time, now)).toThrow();
    expect(() => acceptPoints(Array(501).fill({}), time, now)).toThrow('at most 500');
  });
});

describe('Pacific days', () => {
  it('bounds a normal day and the fall-back day', () => {
    expect(pacificDayBounds('2026-10-22')).toEqual({ start: Date.parse('2026-10-22T07:00:00Z'), end: Date.parse('2026-10-23T07:00:00Z') });
    const fallBack = pacificDayBounds('2026-11-01');
    expect(fallBack.end - fallBack.start).toBe(25 * 3_600_000);
  });
  it('groups points by Pacific date and clips intervals', () => {
    expect(pointDates([{ t: Date.parse('2026-10-23T06:30:00Z'), lat: 0, lng: 0 }, { t: Date.parse('2026-10-23T07:30:00Z'), lat: 0, lng: 0 }])).toEqual(['2026-10-22', '2026-10-23']);
    expect(clip([{ start: 0, end: 10 }, { start: 20, end: 30 }], { start: 5, end: 25 })).toEqual([{ start: 5, end: 10 }, { start: 20, end: 25 }]);
  });
});
