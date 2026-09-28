/** Route publishing destinations are fixed, regardless of assignee or publisher. */
export const ROUTE_CALENDAR_MAILBOX = 'operations@highdesertpm.com';
export const ROUTE_CALENDAR_EVENTS_URL = `https://graph.microsoft.com/v1.0/users/${ROUTE_CALENDAR_MAILBOX}/calendar/events`;
const STORED_EVENT_PREFIX = 'operations:';

export function routeCalendarAttendees() {
  return [
    {emailAddress: {address: 'brody@highdesertpm.com', name: 'Brody'}, type: 'required'},
    {emailAddress: {address: ROUTE_CALENDAR_MAILBOX, name: 'Operations'}, type: 'optional'},
  ];
}

// Preserve the destination with the event ID without changing existing DB columns.
export function storeRouteCalendarEventId(id: string): string {
  return STORED_EVENT_PREFIX + id;
}

export function routeCalendarEventUrl(storedId: string): string {
  if (storedId.startsWith('mailbox:')) {
    const separator = storedId.indexOf(':', 8);
    if (separator < 0) throw new Error('Invalid stored calendar destination');
    const mailbox = storedId.slice(8, separator);
    if (!/^[a-z0-9._+-]+@highdesertpm\.com$/i.test(mailbox)) throw new Error('Invalid calendar mailbox');
    return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(storedId.slice(separator + 1))}`;
  }
  if (storedId.startsWith(STORED_EVENT_PREFIX)) {
    return `https://graph.microsoft.com/v1.0/users/${ROUTE_CALENDAR_MAILBOX}/events/${encodeURIComponent(storedId.slice(STORED_EVENT_PREFIX.length))}`;
  }
  // Previously published routes still belong to their original publisher.
  return `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(storedId)}`;
}

/** Old event IDs did not record their mailbox. Probe exact IDs only; never infer
 * identity from a similar title or create a second event when lookup fails. */
export async function findLegacyRouteCalendarEvent(storedId: string, assignedTo: string | null, accessToken: string): Promise<string | null> {
  if (storedId.startsWith('operations:') || storedId.startsWith('mailbox:')) return null;
  const mailboxes = new Set([ROUTE_CALENDAR_MAILBOX]);
  if (assignedTo && /^[a-z0-9._+-]+@highdesertpm\.com$/i.test(assignedTo)) mailboxes.add(assignedTo.toLowerCase());
  for (const mailbox of mailboxes) {
    const candidate = mailbox === ROUTE_CALENDAR_MAILBOX
      ? storeRouteCalendarEventId(storedId)
      : `mailbox:${mailbox}:${storedId}`;
    const response = await fetch(`${routeCalendarEventUrl(candidate)}?$select=id`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) {
      const event = await response.json();
      if (typeof event.id !== 'string' || !event.id) continue;
      return mailbox === ROUTE_CALENDAR_MAILBOX
        ? storeRouteCalendarEventId(event.id)
        : `mailbox:${mailbox}:${event.id}`;
    }
    if (response.status !== 404 && response.status !== 403) {
      throw new Error(routeCalendarAccessError(response.status) || `Outlook event lookup failed (${response.status}). Please retry.`);
    }
  }
  return null;
}

export function routeCalendarAccessError(status: number): string | null {
  if (status === 401) return 'Calendar access expired. Sign out and back in, then publish again.';
  if (status === 403) return 'Cannot publish to the Operations calendar. Sign out and back in to grant shared-calendar access. Your Microsoft account also needs permission to edit operations@highdesertpm.com’s calendar. No event was added to your personal calendar.';
  return null;
}
