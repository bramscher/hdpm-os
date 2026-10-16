import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { dayRouteEmail, dayRouteText, doorNotes, normalizePhone, notablePriority, scheduleStops, stopRange, type DayRoute, type RouteStopInput } from '../route-day';
import { generateDaySheetPdf } from '../day-sheet-pdf';

const stop = (n: number, extra: Partial<RouteStopInput> = {}): RouteStopInput => ({
  stop_order: n, work_order_id: `wo-${n}`, wo_number: `43280-${n}`, property_name: 'Weinberger 284', unit_name: null,
  address: '3602 SW Badger Ave, Redmond, OR 97756', lat: 44.25, lng: -121.19, drive_minutes_from_prev: 15, service_minutes: 60,
  details: { task: 'Remove TV mount and repair mounting holes', priority: null, permission_to_enter: 'Yes', entry_instructions: 'Lockbox 1234 on the back door' }, ...extra,
});
const route = (stops: RouteStopInput[], extra: Partial<DayRoute> = {}): DayRoute => {
  const { stops: scheduled, finish } = scheduleStops('2026-10-07', '07:30', stops);
  return { routeDate: '2026-10-07', tech: 'Alberto', startTime: '07:30', stops: scheduled, finish, ...extra };
};
const links = { myDay: 'https://hdpm.example/maintenance/field?date=2026-10-07', daySheet: 'https://hdpm.example/api/maintenance/routes/r1/day-sheet' };

describe('scheduleStops', () => {
  it('times each stop from the Pacific start, the drive before it and the time on site', () => {
    const { stops, finish } = scheduleStops('2026-10-07', '07:30', [stop(2, { drive_minutes_from_prev: 10, service_minutes: 45 }), stop(1)]);
    expect(stops.map(s => [s.stop_order, s.arrival, s.departure])).toEqual([
      [1, '2026-10-07T14:45:00.000Z', '2026-10-07T15:45:00.000Z'],
      [2, '2026-10-07T15:55:00.000Z', '2026-10-07T16:40:00.000Z'],
    ]);
    expect(finish).toBe('2026-10-07T16:40:00.000Z');
  });
  it('follows daylight saving time and falls back to 8:00 for a bad start', () => {
    expect(scheduleStops('2026-11-02', '08:00', [stop(1, { drive_minutes_from_prev: 0 })]).stops[0].arrival).toBe('2026-11-02T16:00:00.000Z');
    expect(scheduleStops('2026-10-07', 'soon', [stop(1, { drive_minutes_from_prev: 0 })]).stops[0].arrival).toBe('2026-10-07T15:00:00.000Z');
  });
});

describe('messages', () => {
  it('emails the whole day with times, tasks, door notes and links', () => {
    const mail = dayRouteEmail(route([stop(1), stop(2, { unit_name: 'Unit B', details: { task: 'Paint touch up', priority: 'Urgent' } })], { notes: 'Pick up the paint at Sherwin-Williams first' }), links);
    expect(mail.subject).toBe('Your route for Wed, Oct 7: 2 stops, start 7:30 AM');
    expect(mail.html).toContain('7:45 AM');
    expect(mail.html).toContain('Lockbox 1234 on the back door');
    expect(mail.html).toContain('Weinberger 284 · Unit B');
    expect(mail.html).toContain('Priority: Urgent');
    expect(mail.html).toContain(links.myDay);
    expect(mail.text).toContain('1. 7:45 AM — Weinberger 284');
    expect(mail.text).toContain(`Day sheet: ${links.daySheet}`);
  });
  it('calls out only a priority that matters (AppFolio marks nearly every job Normal)', () => {
    expect(dayRouteEmail(route([stop(1, { details: { task: 'Fix gate', priority: 'Normal' } })]), links).html).not.toContain('Priority');
    expect(notablePriority(' Emergency ')).toBe('Emergency');
    expect(notablePriority('low')).toBeNull();
  });
  it('escapes what comes from work orders', () => {
    const mail = dayRouteEmail(route([stop(1, { details: { task: '<script>alert(1)</script>' } })]), links);
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
  it('says when the route was updated', () => {
    expect(dayRouteEmail(route([stop(1)], { updated: true }), links).subject).toMatch(/^Updated route/);
    expect(dayRouteText(route([stop(1)], { updated: true }), links)).toMatch(/^HDPM: Updated route/);
  });
  it('keeps the text short and points to the full day', () => {
    const many = Array.from({ length: 14 }, (_, i) => stop(i + 1));
    const text = dayRouteText(route(many), links);
    expect(text.length).toBeLessThanOrEqual(620);
    expect(text).toMatch(/\+\d+ more/);
    expect(text.endsWith(`Full day: ${links.myDay}`)).toBe(true);
  });
  it('names the Maps parts by their stops', () => {
    expect(stopRange({ first: 1, last: 4 })).toBe('stops 1–4');
    expect(stopRange({ first: 5, last: 5 })).toBe('stop 5');
    const mail = dayRouteEmail(route(Array.from({ length: 5 }, (_, i) => stop(i + 1))), links);
    expect(mail.html).toContain('>stop 5</a>');
  });
  it('lists door notes in the order they matter', () => {
    expect(doorNotes({ tenant_remarks: 'Dog in yard', permission_to_enter: 'No', entry_instructions: 'Call first' })).toEqual(['Permission to enter: No', 'Entry: Call first', 'Tenant: Dog in yard']);
  });
});

describe('normalizePhone', () => {
  it('turns US numbers into E.164 and rejects the rest', () => {
    expect(normalizePhone('(541) 555-0100')).toBe('+15415550100');
    expect(normalizePhone('1-541-555-0100')).toBe('+15415550100');
    expect(normalizePhone('555-0100')).toBeNull();
  });
});

describe('day sheet', () => {
  it('prints a compact one-page sheet for a normal day, and runs onto more pages for a long one', async () => {
    const short = generateDaySheetPdf(route([stop(1), stop(2), stop(3)], { notes: 'Bring the ladder' }));
    expect(short.subarray(0, 4).toString()).toBe('%PDF');
    expect(short.length).toBeLessThan(300_000);
    expect((await PDFDocument.load(short)).getPageCount()).toBe(1);
    const long = generateDaySheetPdf(route(Array.from({ length: 12 }, (_, i) => stop(i + 1))));
    expect((await PDFDocument.load(long)).getPageCount()).toBeGreaterThan(1);
  });
});
