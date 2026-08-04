import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';

const HDPM_OFFICE = {
  lat: 44.256798,
  lng: -121.184346,
  address: '1515 SW Reindeer Ave, Redmond, OR 97756',
};

// ============================================
// POST /api/inspections/routes/[id]/calendar
// Create an Outlook calendar event for a route
// ============================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accessToken = session.accessToken;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No Microsoft access token. Please sign out and sign back in to grant calendar permissions.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const supabase = getSupabaseAdmin();

    // Fetch route plan
    const { data: routePlan, error: planError } = await supabase
      .from('route_plans')
      .select('*')
      .eq('id', id)
      .single();

    if (planError || !routePlan) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }

    // Fetch stops with inspection and property data (including coordinates)
    const { data: stops, error: stopsError } = await supabase
      .from('route_stops')
      .select(`
        *,
        inspections (
          id,
          inspection_type,
          status,
          due_date,
          priority,
          notes,
          unit_name,
          resident_name,
          inspection_properties (
            id,
            name,
            address_1,
            address_2,
            city,
            state,
            zip,
            latitude,
            longitude,
            appfolio_property_id,
            owner_name
          )
        )
      `)
      .eq('route_plan_id', id)
      .order('stop_order', { ascending: true });

    if (stopsError) {
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }

    // ── Build event metadata ──
    const routeDate = routePlan.route_date; // "YYYY-MM-DD"
    const totalDriveMin = routePlan.total_drive_minutes || 0;
    const totalServiceMin = routePlan.total_service_minutes || 0;
    const totalMinutes = totalDriveMin + totalServiceMin;
    const startHour = 8; // 8:00 AM
    const endHour = startHour + Math.floor(totalMinutes / 60);
    const endMinute = totalMinutes % 60;

    const cities = new Set<string>();
    for (const stop of stops || []) {
      const city = stop.inspections?.inspection_properties?.city;
      if (city) cities.add(city);
    }
    const cityList = Array.from(cities).join(', ');
    const stopCount = stops?.length || routePlan.total_stops || 0;
    const subject = routePlan.name || `Inspection Route - ${cityList || 'Route'} (${stopCount} stops)`;
    const inspectorName = (routePlan.assigned_to || '').split('@')[0];
    const inspectorCapitalized = inspectorName.charAt(0).toUpperCase() + inspectorName.slice(1);

    // ── Build per-stop data with estimated arrival times ──
    let runningMinutes = 0; // minutes after 8:00 AM
    const stopDetails = (stops || []).map((stop, i) => {
      const insp = stop.inspections;
      const prop = insp?.inspection_properties;
      const address = prop ? `${prop.address_1}, ${prop.city}, ${prop.state} ${prop.zip}` : 'Unknown';
      const unit = insp?.unit_name ? ` - ${insp.unit_name}` : prop?.address_2 ? ` - ${prop.address_2}` : '';
      const type = insp?.inspection_type || 'Inspection';
      const resident = insp?.resident_name || null;
      const priority = insp?.priority || 'normal';
      const dueDate = insp?.due_date || null;
      const driveMin = Math.round(stop.drive_minutes_from_prev || stop.drive_minutes_from_previous || 0);
      const serviceMin = stop.service_minutes || 30;
      const lat = prop?.latitude || null;
      const lng = prop?.longitude || null;
      const propertyCode = prop?.appfolio_property_id || prop?.name || null;
      const ownerName = prop?.owner_name || null;

      // Estimated arrival = start time + cumulative drive + cumulative service so far
      runningMinutes += driveMin;
      const arrivalHour = startHour + Math.floor(runningMinutes / 60);
      const arrivalMin = runningMinutes % 60;
      const arrivalTime = formatTime12(arrivalHour, arrivalMin);

      const departureMinutes = runningMinutes + serviceMin;
      const departHour = startHour + Math.floor(departureMinutes / 60);
      const departMin = departureMinutes % 60;
      const departTime = formatTime12(departHour, departMin);

      runningMinutes += serviceMin;

      // Individual Apple Maps link for this stop
      const mapsLink = lat && lng
        ? `https://maps.apple.com/?address=${encodeURIComponent(address)}&ll=${lat},${lng}`
        : `https://maps.apple.com/?address=${encodeURIComponent(address)}`;

      return {
        index: i + 1,
        address,
        unit,
        type,
        resident,
        priority,
        dueDate,
        driveMin,
        serviceMin,
        arrivalTime,
        departTime,
        lat,
        lng,
        mapsLink,
        propertyCode,
        ownerName,
      };
    });

    // ── Build multi-stop routing URLs ──
    // Apple Maps: saddr=office&daddr=stop1+to:stop2+to:stop3...
    const stopCoords = stopDetails
      .filter(s => s.lat && s.lng)
      .map(s => `${s.lat},${s.lng}`);

    const appleDestinations = stopCoords.join('+to:');
    const appleMapsUrl = stopCoords.length > 0
      ? `https://maps.apple.com/?saddr=${HDPM_OFFICE.lat},${HDPM_OFFICE.lng}&daddr=${appleDestinations}&dirflg=d`
      : null;

    // Google Maps: /dir/office/stop1/stop2/stop3
    const googleWaypoints = stopDetails
      .map(s => s.lat && s.lng ? `${s.lat},${s.lng}` : encodeURIComponent(s.address));
    const googleMapsUrl = `https://www.google.com/maps/dir/${HDPM_OFFICE.lat},${HDPM_OFFICE.lng}/${googleWaypoints.join('/')}`;

    // Estimated finish time
    const finishTime = formatTime12(
      startHour + Math.floor(runningMinutes / 60),
      runningMinutes % 60
    );

    // ── Priority badge helper ──
    function priorityBadge(p: string): string {
      const colors: Record<string, string> = {
        urgent: 'background:#dc2626;color:white;',
        high: 'background:#f59e0b;color:white;',
        normal: 'background:#e5e7eb;color:#374151;',
        low: 'background:#dbeafe;color:#1e40af;',
      };
      return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;${colors[p] || colors.normal}">${p}</span>`;
    }

    // ── Build HTML body ──
    const stopRows = stopDetails.map((s) => {
      const dueDateStr = s.dueDate
        ? new Date(s.dueDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      const overdue = s.dueDate && new Date(s.dueDate + 'T12:00:00') < new Date();

      const propertyMeta = [s.propertyCode, s.ownerName ? `Owner: ${s.ownerName}` : null]
        .filter(Boolean)
        .join(' &middot; ');

      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;vertical-align:top;width:30px;">${s.index}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <a href="${s.mapsLink}" style="color:#2563eb;text-decoration:none;font-weight:600;">${s.address}</a>${s.unit ? `<br/><span style="color:#6b7280;font-size:12px;">${s.unit}</span>` : ''}
          ${propertyMeta ? `<br/><span style="color:#6b7280;font-size:12px;">${propertyMeta}</span>` : ''}
          ${s.resident ? `<br/><span style="color:#6b7280;font-size:12px;">Tenant: ${s.resident}</span>` : ''}
          <br/><span style="font-size:12px;">${s.type} ${priorityBadge(s.priority)}${dueDateStr ? ` &middot; Due: <span style="${overdue ? 'color:#dc2626;font-weight:600;' : ''}">${dueDateStr}</span>` : ''}</span>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;font-size:13px;">
          <strong>${s.arrivalTime}</strong> - ${s.departTime}<br/>
          <span style="color:#6b7280;font-size:12px;">${s.driveMin}m drive + ${s.serviceMin}m service</span>
        </td>
      </tr>`;
    }).join('');

    const htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;">

        <h2 style="margin:0 0 4px;color:#111827;">Inspection Route - ${inspectorCapitalized}</h2>
        <p style="margin:0 0 16px;color:#6b7280;font-size:14px;">${stopCount} stops across ${cityList || 'Central Oregon'}</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:14px;">
          <tr>
            <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Date</strong><br/>${new Date(routeDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</td>
            <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Start</strong><br/>8:00 AM</td>
            <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Est. Finish</strong><br/>${finishTime}</td>
            <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;width:25%;"><strong>Total</strong><br/>${formatDuration(totalDriveMin)} drive + ${formatDuration(totalServiceMin)} service</td>
          </tr>
        </table>

        ${routePlan.notes ? `<p style="margin:0 0 16px;padding:8px 12px;background:#fefce8;border:1px solid #fde68a;border-radius:6px;font-size:13px;"><strong>Notes:</strong> ${routePlan.notes}</p>` : ''}

        <div style="margin-bottom:16px;">
          ${appleMapsUrl ? `<a href="${appleMapsUrl}" style="display:inline-block;padding:8px 16px;background:#111827;color:white;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;margin-right:8px;">Open Full Route in Apple Maps</a>` : ''}
          <a href="${googleMapsUrl}" style="display:inline-block;padding:8px 16px;background:#4285f4;color:white;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Open Full Route in Google Maps</a>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="background:#f3f4f6;">
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;width:30px;">#</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;">Property</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;width:140px;">Schedule</th>
          </tr>
          ${stopRows}
        </table>

        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
          Start: ${HDPM_OFFICE.address} &middot; Generated by HDPM Route Planner
        </p>
      </div>
    `;

    // ── First stop for event location ──
    const firstStop = stopDetails[0];
    const location = firstStop ? firstStop.address : '';

    // ── Attendees ──
    const attendees = [];
    const inspectorEmail = routePlan.assigned_to;
    if (inspectorEmail) {
      attendees.push({
        emailAddress: { address: inspectorEmail, name: inspectorCapitalized },
        type: 'required',
      });
    }
    // Always cc the operations admin (Craig) as a required attendee on every route.
    const opsAdminEmail = 'craigbramscher@gmail.com';
    if (inspectorEmail?.toLowerCase() !== opsAdminEmail) {
      attendees.push({
        emailAddress: { address: opsAdminEmail, name: 'Craig Bramscher' },
        type: 'required',
      });
    }
    attendees.push({
      emailAddress: { address: 'operations@highdesertpm.com', name: 'Operations' },
      type: 'optional',
    });

    // ── Microsoft Graph event payload ──
    const event = {
      subject,
      body: {
        contentType: 'HTML',
        content: htmlBody,
      },
      start: {
        dateTime: `${routeDate}T${String(startHour).padStart(2, '0')}:00:00`,
        timeZone: 'America/Los_Angeles',
      },
      end: {
        dateTime: `${routeDate}T${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`,
        timeZone: 'America/Los_Angeles',
      },
      location: {
        displayName: location,
      },
      attendees,
      isReminderOn: true,
      reminderMinutesBeforeStart: 30,
    };

    // ── Dry-run escape hatch ──
    // Set INSPECTION_CALENDAR_DRYRUN=1 to skip the Graph POST and return the
    // generated event JSON instead. Useful for verifying body + attendees before
    // sending real invitations.
    if (process.env.INSPECTION_CALENDAR_DRYRUN === '1') {
      return NextResponse.json({ success: true, dryRun: true, event });
    }

    // ── Call Microsoft Graph API ──
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!graphRes.ok) {
      const errorBody = await graphRes.text();
      console.error('Microsoft Graph error:', graphRes.status, errorBody);

      if (graphRes.status === 401) {
        return NextResponse.json(
          { error: 'Calendar access expired. Please sign out and sign back in.' },
          { status: 401 }
        );
      }

      return NextResponse.json(
        { error: `Failed to create calendar event: ${graphRes.statusText}` },
        { status: 502 }
      );
    }

    const createdEvent = await graphRes.json();

    // Store the event ID on the route plan for cleanup on deletion
    await supabase
      .from('route_plans')
      .update({ calendar_event_id: createdEvent.id })
      .eq('id', id);

    return NextResponse.json({
      success: true,
      eventId: createdEvent.id,
      webLink: createdEvent.webLink,
    });
  } catch (error) {
    console.error('Calendar POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to create calendar event';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Helpers ──

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
