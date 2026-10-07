/**
 * Tenant inspection notice text, shared by the Send Notices window and Dez.
 *
 * AppFolio has no send API, so notices go out from AppFolio itself. The
 * fastest path is Realm-X Assistant → "Send Bulk Email": staff paste one
 * request per route and Realm-X drafts the email to the units' CURRENT
 * tenants from AppFolio's own records, then staff review and send. One bulk
 * email has one body, so it carries the route's arrival window, not a
 * per-unit time.
 */

import { inspectionSchedule, type TimingStop } from './route-builder/inspection-schedule';
import { routeTimeLabel } from './route-builder/inspection-time';

export const COMPANY_NAME = 'High Desert Property Management';

/**
 * Realm-X Assistant isn't on HDPM's AppFolio plan yet. Until it is, notices go
 * out through the AppFolio letter template and the Realm-X request stays hidden.
 * Set NEXT_PUBLIC_REALMX_ENABLED=1 in Vercel once Realm-X is available.
 */
export function realmxEnabled(): boolean {
  return process.env.NEXT_PUBLIC_REALMX_ENABLED === '1';
}

/** The date line staff paste into the letter, e.g. "Wednesday, October 14, 2026, between 8:30 AM and 1:00 PM". */
export function noticeDateLine(dateStr: string, windowLabel?: string | null): string {
  return windowLabel ? `${longDate(dateStr)}, ${windowLabel}` : longDate(dateStr);
}
export const COMPANY_PHONE = '(541) 548-0383';

export function longDate(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export interface ArrivalWindow {
  /** Minutes after the route start the window opens / closes. */
  startMinutes: number;
  endMinutes: number;
  /** e.g. "between 8:30 AM and 1:00 PM" */
  label: string;
}

/** Per-stop arrival labels and the route's window, from the same timing the route page shows. */
export function routeArrivals(startTime: string | null | undefined, stops: TimingStop[]): {
  arrivals: (string | null)[];
  window: ArrivalWindow | null;
} {
  const timing = inspectionSchedule(stops);
  const active = timing.visits.filter((_, i) => stops[i].status !== 'skipped');
  const arrivals = timing.visits.map((v, i) => (stops[i].status === 'skipped' ? null : routeTimeLabel(startTime, v.arrivalMinutes)));
  if (active.length === 0) return { arrivals, window: null };
  const first = Math.min(...active.map((v) => v.arrivalMinutes));
  const last = Math.max(...active.map((v) => v.arrivalMinutes));
  const startMinutes = Math.floor(first / 30) * 30;
  const endMinutes = Math.ceil((last + 30) / 30) * 30;
  return {
    arrivals,
    window: {
      startMinutes,
      endMinutes,
      label: `between ${routeTimeLabel(startTime, startMinutes)} and ${routeTimeLabel(startTime, endMinutes)}`,
    },
  };
}

/** Generic notice for a bulk send: one date (and window) for every recipient. */
export function routeNotice(dateStr: string, windowLabel?: string | null, dateChanged = false): { subject: string; body: string } {
  const d = longDate(dateStr);
  const when = windowLabel ? `${d}, ${windowLabel}` : d;
  return {
    subject: `${dateChanged ? 'Updated: ' : ''}Notice of Routine Property Inspection — ${d}`,
    body: [
      'Hello,',
      '',
      dateChanged
        ? `Your routine inspection has been moved. ${COMPANY_NAME} will now conduct the inspection of your residence on ${when}. This replaces the date in our earlier notice.`
        : `This is an advance notice that ${COMPANY_NAME} will conduct a routine inspection of your residence on ${when}.`,
      '',
      'Routine inspections occur about twice a year and help us keep the property well maintained. Our inspector will briefly walk through the unit to check its condition and note any maintenance needs. You are welcome to be present but do not need to be.',
      '',
      `Please make sure pets are secured and the unit is accessible on that day. If the scheduled date does not work, contact us as soon as possible at ${COMPANY_PHONE}.`,
      '',
      'Thank you,',
      COMPANY_NAME,
      COMPANY_PHONE,
    ].join('\n'),
  };
}

export interface RealmxUnit {
  address: string;
}

/** Paste-ready request for AppFolio Realm-X Assistant ("Send Bulk Email"). */
export function buildRealmxRequest(input: {
  routeDate: string;
  windowLabel?: string | null;
  units: RealmxUnit[];
  dateChanged?: boolean;
}): { request: string; subject: string; body: string } {
  const { subject, body } = routeNotice(input.routeDate, input.windowLabel, input.dateChanged);
  const unitLines = [...new Set(input.units.map((u) => u.address))].map((a) => `- ${a}`).join('\n');
  const request = [
    'Draft a bulk email (do not send yet) to the current tenants of these units:',
    unitLines,
    '',
    `Subject: ${subject}`,
    '',
    'Body:',
    body,
  ].join('\n');
  return { request, subject, body };
}
