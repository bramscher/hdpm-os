import { describe, it, expect } from 'vitest';
import { pacific, weekDates, weekBlocks, runColor, timeLabel } from '../calendar';
import { routineById } from '../registry';

describe('pacific', () => {
  it('converts UTC to Pacific weekday/hour (PDT)', () => {
    expect(pacific(new Date('2026-10-05T13:45:00Z'))).toEqual({ day: 0, hour: 6, minute: 45, date: '2026-10-05' });
  });
  it('rolls back a day across midnight', () => {
    // 00:00 UTC Tuesday = 5 PM Monday Pacific (the ops brief)
    expect(pacific(new Date('2026-10-06T00:00:00Z'))).toMatchObject({ day: 0, hour: 17, date: '2026-10-05' });
  });
  it('uses PST in winter', () => {
    expect(pacific(new Date('2026-12-07T13:45:00Z')).hour).toBe(5);
  });
});

describe('weekDates', () => {
  it('returns Monday through Sunday of the Pacific week', () => {
    expect(weekDates(new Date('2026-10-08T18:00:00Z'))).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ]);
  });
  it('treats late Sunday evening Pacific as the same week', () => {
    // 2026-10-12 03:00 UTC = Sunday Oct 11, 8 PM PDT
    expect(weekDates(new Date('2026-10-12T03:00:00Z'))[0]).toBe('2026-10-05');
  });
});

describe('weekBlocks', () => {
  const now = new Date('2026-10-07T18:00:00Z');
  it('places the estimate chaser at 6:45 AM on each weekday', () => {
    const r = routineById('estimate_chaser')!;
    const blocks = weekBlocks(now, [r]);
    expect(blocks.map((b) => [b.day, b.hour, b.minute])).toEqual([[0, 6, 45], [1, 6, 45], [2, 6, 45], [3, 6, 45], [4, 6, 45]]);
  });
  it('puts the 00:00 UTC Tue–Sat ops brief on Mon–Fri evenings', () => {
    const blocks = weekBlocks(now, [routineById('ops_brief')!]);
    expect(blocks.map((b) => [b.day, b.hour])).toEqual([[0, 17], [1, 17], [2, 17], [3, 17], [4, 17]]);
  });
  it('leaves continuous routines out', () => {
    expect(weekBlocks(now, [routineById('wo_sync_15m')!, routineById('keys_sync')!])).toEqual([]);
  });
  it('omits routines that do not fire this week', () => {
    expect(weekBlocks(now, [routineById('hud_sync')!])).toEqual([]);
  });
});

describe('runColor / timeLabel', () => {
  it('maps statuses to calendar colours', () => {
    expect(['ok', 'halted', 'skipped', 'error', 'running', undefined].map(runColor)).toEqual(['ok', 'warn', 'warn', 'error', 'running', 'never']);
  });
  it('formats times', () => {
    expect(timeLabel(0, 5)).toBe('12:05 AM');
    expect(timeLabel(13, 0)).toBe('1:00 PM');
  });
});
