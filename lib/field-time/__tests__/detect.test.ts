import { describe, expect, it } from 'vitest';
import { cleanPoints, detectPieces, detectStops } from '../detect';
import { CEDAR, LOWES, PLACES, SHOP, WEINBERGER, drive, min, offset, stay } from './fixtures';

describe('detectStops', () => {
  it('finds a stop from dense fixes', () => {
    const stops = detectStops(stay(WEINBERGER, 0, 60));
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ start: min(0), end: min(60) });
  });

  it('keeps one stop when a still phone reports rarely', () => {
    const stops = detectStops([...stay(WEINBERGER, 0, 0), ...stay(offset(WEINBERGER, 40, 0), 25, 25), ...stay(offset(WEINBERGER, -60, 30), 50, 50)]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ start: min(0), end: min(50) });
  });

  it('drops a single-fix GPS spike', () => {
    const fixes = stay(WEINBERGER, 0, 40);
    fixes[10] = { ...fixes[10], ...offset(WEINBERGER, 600, 0) };
    expect(cleanPoints(fixes)).toHaveLength(fixes.length - 1);
    expect(detectStops(fixes)).toHaveLength(1);
  });

  it('ignores inaccurate fixes', () => {
    expect(cleanPoints([{ t: min(0), ...WEINBERGER, acc: 400 }, { t: min(1), ...WEINBERGER, acc: 20 }])).toHaveLength(1);
  });

  it('ignores a traffic-light pause while driving', () => {
    const fixes = [...drive(SHOP, WEINBERGER, 0, 10), { t: min(11), ...offset(SHOP, 1500, 500), acc: 10 }, { t: min(12), ...offset(SHOP, 1500, 500), acc: 10 }, ...drive(offset(SHOP, 1500, 500), WEINBERGER, 12, 20)];
    expect(detectStops(fixes)).toHaveLength(0);
  });

  it('keeps a short stop only inside a known place', () => {
    expect(detectStops(stay(LOWES, 0, 4, 1), PLACES)).toHaveLength(1);
    expect(detectStops(stay(CEDAR, 0, 4, 1), PLACES)).toHaveLength(0);
  });

  it('merges a stop split by walking between nearby buildings', () => {
    const stops = detectStops([...stay(WEINBERGER, 0, 20), ...stay(offset(WEINBERGER, 120, 0), 24, 60)]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ start: min(0), end: min(60) });
  });
});

describe('detectPieces', () => {
  const window = { start: min(0), end: min(240) };

  it('covers the window with stops and drives', () => {
    const fixes = [...stay(SHOP, 0, 20), ...drive(SHOP, WEINBERGER, 20, 30), ...stay(WEINBERGER, 30, 200), ...drive(WEINBERGER, SHOP, 200, 210), ...stay(SHOP, 210, 240)];
    const pieces = detectPieces(fixes, window);
    expect(pieces.map(p => p.type)).toEqual(['stop', 'drive', 'stop', 'drive', 'stop']);
    expect(pieces[0].start).toBe(window.start);
    expect(pieces[pieces.length - 1].end).toBe(window.end);
  });

  it('marks a phone-off stretch between far-apart places as no data', () => {
    const fixes = [...stay(SHOP, 0, 30), ...stay(CEDAR, 150, 240)];
    const pieces = detectPieces(fixes, window);
    expect(pieces.map(p => p.type)).toEqual(['stop', 'no_data', 'stop']);
    expect(pieces[1]).toMatchObject({ start: min(30), end: min(150) });
  });

  it('treats a short unreported drive as driving', () => {
    const fixes = [...stay(SHOP, 0, 30), ...stay(WEINBERGER, 45, 240)];
    expect(detectPieces(fixes, window).map(p => p.type)).toEqual(['stop', 'drive', 'stop']);
  });

  it('stretches short edges and marks long ones as no data', () => {
    expect(detectPieces(stay(SHOP, 5, 240), window)[0]).toMatchObject({ type: 'stop', start: window.start });
    const late = detectPieces(stay(SHOP, 40, 240), window);
    expect(late[0]).toMatchObject({ type: 'no_data', start: window.start, end: min(40) });
  });

  it('is all no data with no fixes', () => {
    expect(detectPieces([], window)).toEqual([{ type: 'no_data', start: window.start, end: window.end }]);
  });
});
