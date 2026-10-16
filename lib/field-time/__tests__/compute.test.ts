import { describe, expect, it } from 'vitest';
import { computeDay, type DayInput } from '../compute';
import { detectStops } from '../detect';
import { needsInput, type Segment } from '../model';
import { sampleBreaks, samplePoints, sampleWindow, validateSampleSpec, type SamplePlace, type SampleStop } from '../sample';
import { DATE, PLACES, UNITS, WORK_ORDERS, min } from './fixtures';

const locate = (p: SamplePlace) => (p.type === 'place' ? PLACES.find(x => x.id === p.id) ?? null : p.type === 'unit' ? UNITS.find(u => u.id === p.id) ?? null : p);
const shop: SamplePlace = { type: 'place', id: 'shop' }, lowes: SamplePlace = { type: 'place', id: 'lowes' }, hd: SamplePlace = { type: 'place', id: 'hd' };
const dump: SamplePlace = { type: 'place', id: 'dump' }, wein: SamplePlace = { type: 'unit', id: 'u-wein' }, cedar: SamplePlace = { type: 'unit', id: 'u-cedar' };
const S = (arrive: string, depart: string, place: SamplePlace): SampleStop => ({ arrive, depart, place });

function day(stops: SampleStop[], extra: { breaks?: { start: string; end: string }[]; phoneOff?: { start: string; end: string }[] } = {}, input: Partial<DayInput> = {}) {
  const spec = validateSampleSpec({ start: '08:00', end: '16:30', stops, ...extra });
  return computeDay({
    technician: 'Alberto', date: DATE, windows: [sampleWindow(spec, DATE)], points: samplePoints(spec, DATE, locate),
    places: PLACES, units: UNITS, workOrders: WORK_ORDERS, inspectionStops: [], breaks: sampleBreaks(spec, DATE), ...input,
  });
}
const shape = (segments: Segment[]) => segments.map(s => `${s.kind}${s.allocations.length ? `[${s.allocations.map(a => `${a.work_order_id}:${a.percent}`).join(',')}]` : ''}`);
const mins = (s: Segment) => (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000;

describe('computeDay', () => {
  it('A → store → A: the parts run is drive in, store and drive back, all on A', () => {
    const { segments } = day([S('08:00', '08:20', shop), S('08:35', '11:10', wein), S('11:25', '11:45', lowes), S('12:00', '14:00', wein), S('14:15', '16:30', shop)]);
    expect(shape(segments)).toEqual(['shop', 'drive', 'on_site[wo-wein:100]', 'parts_run[wo-wein:100]', 'on_site[wo-wein:100]', 'drive', 'shop']);
    const run = segments.find(s => s.kind === 'parts_run')!;
    expect(mins(run)).toBe(50);
    expect(run.property_label).toBe("Lowe's Redmond");
    expect(segments[0].started_at).toBe(new Date(min(0)).toISOString());
    expect(segments[segments.length - 1].ended_at).toBe(new Date(min(510)).toISOString());
  });

  it('A → store → B: the run waits for the tech to tick jobs, offering both', () => {
    const { segments } = day([S('08:35', '11:10', wein), S('11:25', '11:45', lowes), S('12:05', '14:00', cedar)]);
    const run = segments.find(s => s.kind === 'parts_run')!;
    expect(run.allocations).toEqual([]);
    expect(needsInput(run)).toBe(true);
    expect(run.candidates.map(c => c.work_order_id)).toEqual(expect.arrayContaining(['wo-wein', 'wo-cedar']));
  });

  it("chains Lowe's then Home Depot into one run", () => {
    const { segments } = day([S('08:35', '11:10', wein), S('11:25', '11:45', lowes), S('11:55', '12:10', hd), S('12:30', '14:00', wein)]);
    const runs = segments.filter(s => s.kind === 'parts_run');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ property_label: "Lowe's Redmond → Home Depot Redmond", allocations: [{ work_order_id: 'wo-wein', percent: 100 }] });
    expect(mins(runs[0])).toBe(80);
  });

  it('an end-of-day run back to the shop is left for the tech to assign', () => {
    const { segments } = day([S('08:35', '14:00', wein), S('14:20', '14:40', lowes), S('14:55', '16:30', shop)]);
    expect(shape(segments).slice(-2)).toEqual(['parts_run', 'shop']);
  });

  it('a dump run between two jobs needs the jobs ticked; a dump then store is two runs', () => {
    const one = day([S('08:35', '11:00', wein), S('11:20', '11:40', dump), S('12:00', '14:00', cedar)]).segments;
    expect(shape(one)).toContain('dump_run');
    expect(one.find(s => s.kind === 'dump_run')!.allocations).toEqual([]);
    const two = day([S('08:35', '11:00', wein), S('11:20', '11:40', dump), S('12:00', '12:20', lowes), S('12:40', '14:00', wein)]).segments;
    expect(shape(two).filter(k => k.startsWith('dump_run') || k.startsWith('parts_run'))).toEqual(['dump_run', 'parts_run']);
  });

  it('turns a timed break into a break segment', () => {
    const { segments } = day([S('08:35', '14:00', wein)], { breaks: [{ start: '12:00', end: '12:30' }] });
    // No fixes before 08:35 or after 14:00, so those stretches are unknown, not driving.
    expect(shape(segments)).toEqual(['no_data', 'on_site[wo-wein:100]', 'break', 'on_site[wo-wein:100]', 'no_data']);
    expect(mins(segments[2])).toBe(30);
  });

  it('marks a phone-off stretch as no data', () => {
    const { segments } = day([S('08:00', '08:20', shop), S('08:35', '14:00', wein), S('14:15', '16:30', shop)], { phoneOff: [{ start: '13:00', end: '15:00' }] });
    const gap = segments.find(s => s.kind === 'no_data')!;
    // Fixes come every 2 minutes on odd minutes, so the gap runs from the 12:59 fix to the 15:01 fix.
    expect(gap.started_at).toBe(new Date(min(299)).toISOString());
    expect(gap.ended_at).toBe(new Date(min(421)).toISOString());
    expect(needsInput(gap)).toBe(true);
  });

  it('never suggests over confirmed time', () => {
    const confirmed = [{ start: min(35), end: min(190) }];
    const { segments } = day([S('08:00', '08:20', shop), S('08:35', '11:10', wein), S('11:25', '16:30', shop)], {}, { confirmed });
    expect(segments.every(s => Date.parse(s.ended_at) <= min(35) || Date.parse(s.started_at) >= min(190))).toBe(true);
  });

  it('adding a store location turns an unknown stop into a parts run', () => {
    const stops = [S('08:35', '11:10', wein), S('11:25', '11:45', lowes), S('12:00', '14:00', wein)];
    const without = day(stops, {}, { places: PLACES.filter(p => p.id !== 'lowes') }).segments;
    expect(shape(without)).toContain('stop');
    expect(shape(day(stops).segments)).toContain('parts_run[wo-wein:100]');
  });
});

describe('sample days', () => {
  it('round-trips: generated fixes come back as the same stops', () => {
    const spec = validateSampleSpec({ start: '08:00', end: '16:30', stops: [S('08:00', '08:20', shop), S('08:35', '11:10', wein), S('11:25', '11:45', lowes), S('12:00', '16:30', cedar)] });
    const stops = detectStops(samplePoints(spec, DATE, locate), PLACES);
    expect(stops.map(s => [(s.start - min(0)) / 60000, (s.end - min(0)) / 60000])).toEqual([[0, 20], [35, 190], [205, 225], [240, 510]]);
  });

  it('rejects specs the pipeline cannot use', () => {
    expect(() => validateSampleSpec({ start: '08:00', end: '16:00', stops: [] })).toThrow(/at least one stop/);
    expect(() => validateSampleSpec({ start: '08:00', end: '16:00', stops: [S('09:00', '08:30', shop)] })).toThrow(/leave after/);
    expect(() => validateSampleSpec({ start: '08:00', end: '16:00', stops: [S('08:00', '10:00', shop), S('09:30', '11:00', wein)] })).toThrow(/overlaps/);
    expect(() => validateSampleSpec({ start: '08:00', end: '16:00', stops: [S('08:00', '10:00', { type: 'unit', id: "x'; drop" })] })).toThrow(/choose where/);
    expect(() => validateSampleSpec({ start: '8am', end: '16:00', stops: [] })).toThrow(/time like/);
  });
});
