/**
 * Maintenance OS — Outlook calendar event for a published day route.
 *
 * Mirrors the inspection-route calendar publish
 * (app/api/inspections/routes/[id]/calendar/route.ts): one event on the
 * publisher's calendar via Microsoft Graph, 8 AM start, per-stop arrival /
 * departure estimates, Apple + Google full-route links. Attendees: the crew
 * tech (email resolved from maint_digest_recipient) + the ops admin +
 * operations@. Set MAINT_ROUTE_CALENDAR_DRYRUN=1 to get the event JSON back
 * instead of POSTing to Graph.
 */

import { listDigestRecipients } from './recipients';

const HDPM_OFFICE = {
  lat: 44.256798,
  lng: -121.184346,
  address: '1515 SW Reindeer Ave, Redmond, OR 97756',
};

const OPS_ADMIN_EMAIL = 'craigbramscher@gmail.com';
const START_HOUR = 8; // 8:00 AM PT

export interface RouteCalendarStop {
  stop_order: number;
  wo_number: string | null;
  description: string;
  property_name: string;
  unit_name: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  drive_minutes_from_prev: number;
  service_minutes: number;
}

export interface RouteCalendarInput {
  routeDate: string; // YYYY-MM-DD
  assignedTech: string;
  totalDriveMinutes: number;
  totalServiceMinutes: number;
  stops: RouteCalendarStop[];
}

export type RouteCalendarResult =
  | { created: true; eventId: string; webLink: string | null }
  | { created: false; dryRun: true; event: unknown }
  | { created: false; dryRun?: false; error: string };

function formatTime12(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h}:${String(minute).padStart(2, '0')} ${ampm}`;
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export async function createRouteCalendarEvent(
  input: RouteCalendarInput,
  accessToken: string
): Promise<RouteCalendarResult> {
  const { routeDate, assignedTech, stops } = input;
  const totalMinutes = input.totalDriveMinutes + input.totalServiceMinutes;
  const endHour = START_HOUR + Math.floor(totalMinutes / 60);
  const endMinute = totalMinutes % 60;

  // ── Per-stop ETAs ──
  let runningMinutes = 0;
  const stopDetails = stops.map((s) => {
    runningMinutes += Math.round(s.drive_minutes_from_prev);
    const arrival = formatTime12(START_HOUR + Math.floor(runningMinutes / 60), runningMinutes % 60);
    runningMinutes += s.service_minutes;
    const depart = formatTime12(START_HOUR + Math.floor(runningMinutes / 60), runningMinutes % 60);
    const mapsLink =
      s.lat != null && s.lng != null
        ? `https://maps.apple.com/?address=${encodeURIComponent(s.address)}&ll=${s.lat},${s.lng}`
        : `https://maps.apple.com/?address=${encodeURIComponent(s.address)}`;
    return { ...s, arrival, depart, mapsLink };
  });
  const finishTime = formatTime12(START_HOUR + Math.floor(runningMinutes / 60), runningMinutes % 60);

  // ── Full-route links ──
  const coords = stopDetails.filter((s) => s.lat != null && s.lng != null).map((s) => `${s.lat},${s.lng}`);
  const appleMapsUrl =
    coords.length > 0
      ? `https://maps.apple.com/?saddr=${HDPM_OFFICE.lat},${HDPM_OFFICE.lng}&daddr=${coords.join('+to:')}&dirflg=d`
      : null;
  const googleWaypoints = stopDetails.map((s) =>
    s.lat != null && s.lng != null ? `${s.lat},${s.lng}` : encodeURIComponent(s.address)
  );
  const googleMapsUrl = `https://www.google.com/maps/dir/${HDPM_OFFICE.lat},${HDPM_OFFICE.lng}/${googleWaypoints.join('/')}`;

  // ── HTML body ──
  const stopRows = stopDetails
    .map(
      (s) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;vertical-align:top;width:30px;">${s.stop_order}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <a href="${s.mapsLink}" style="color:#2563eb;text-decoration:none;font-weight:600;">${s.address}</a>
          <br/><span style="color:#374151;font-size:12px;">${s.property_name}${s.unit_name ? ` · ${s.unit_name}` : ''}${s.wo_number ? ` · WO #${s.wo_number}` : ''}</span>
          ${s.description ? `<br/><span style="color:#6b7280;font-size:12px;">${s.description.slice(0, 140)}</span>` : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;font-size:13px;">
          <strong>${s.arrival}</strong> - ${s.depart}<br/>
          <span style="color:#6b7280;font-size:12px;">${Math.round(s.drive_minutes_from_prev)}m drive + ${s.service_minutes}m on-site</span>
        </td>
      </tr>`
    )
    .join('');

  const htmlBody = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;">
      <h2 style="margin:0 0 4px;color:#111827;">Maintenance Day Route - ${assignedTech}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">${stops.length} stops</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Date</strong><br/>${new Date(routeDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</td>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Start</strong><br/>8:00 AM</td>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Est. Finish</strong><br/>${finishTime}</td>
          <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Total</strong><br/>${formatDuration(input.totalDriveMinutes)} drive + ${formatDuration(input.totalServiceMinutes)} on-site</td>
        </tr>
      </table>
      <div style="margin-bottom:16px;">
        ${appleMapsUrl ? `<a href="${appleMapsUrl}" style="display:inline-block;padding:8px 16px;background:#111827;color:white;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;margin-right:8px;">Open Full Route in Apple Maps</a>` : ''}
        <a href="${googleMapsUrl}" style="display:inline-block;padding:8px 16px;background:#4285f4;color:white;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Open Full Route in Google Maps</a>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#f3f4f6;">
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;width:30px;">#</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;">Work order</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;width:140px;">Schedule</th>
        </tr>
        ${stopRows}
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
        Start: ${HDPM_OFFICE.address} &middot; Published from the HDPM-OS maintenance board
      </p>
    </div>
  `;

  // ── Attendees: tech (from digest recipient map) + ops admin + operations@ ──
  const recipients = await listDigestRecipients();
  const techEmail =
    recipients.find((r) => r.person.toLowerCase() === assignedTech.toLowerCase())?.email ?? null;

  const attendees: { emailAddress: { address: string; name: string }; type: string }[] = [];
  if (techEmail) {
    attendees.push({ emailAddress: { address: techEmail, name: assignedTech }, type: 'required' });
  }
  if (techEmail?.toLowerCase() !== OPS_ADMIN_EMAIL) {
    attendees.push({
      emailAddress: { address: OPS_ADMIN_EMAIL, name: 'Craig Bramscher' },
      type: 'required',
    });
  }
  attendees.push({
    emailAddress: { address: 'operations@highdesertpm.com', name: 'Operations' },
    type: 'optional',
  });

  const event = {
    subject: `Maintenance Route - ${assignedTech} (${stops.length} stops)`,
    body: { contentType: 'HTML', content: htmlBody },
    start: {
      dateTime: `${routeDate}T${String(START_HOUR).padStart(2, '0')}:00:00`,
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: `${routeDate}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
      timeZone: 'America/Los_Angeles',
    },
    location: { displayName: stopDetails[0]?.address ?? '' },
    attendees,
    isReminderOn: true,
    reminderMinutesBeforeStart: 30,
  };

  if (process.env.MAINT_ROUTE_CALENDAR_DRYRUN === '1') {
    return { created: false, dryRun: true, event };
  }

  const graphRes = await fetch('https://graph.microsoft.com/v1.0/me/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!graphRes.ok) {
    const body = await graphRes.text();
    console.error('[RouteCalendar] Graph error:', graphRes.status, body);
    return {
      created: false,
      error:
        graphRes.status === 401
          ? 'Calendar access expired. Please sign out and sign back in.'
          : `Failed to create calendar event: ${graphRes.statusText}`,
    };
  }

  const created = await graphRes.json();
  return { created: true, eventId: created.id, webLink: created.webLink ?? null };
}

/** Best-effort Graph event deletion when a route is canceled. */
export async function deleteRouteCalendarEvent(eventId: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    console.error('[RouteCalendar] Graph delete failed:', res.status);
    return false;
  }
  return true;
}
