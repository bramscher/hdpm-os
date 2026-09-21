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
  if (storedId.startsWith(STORED_EVENT_PREFIX)) {
    return `https://graph.microsoft.com/v1.0/users/${ROUTE_CALENDAR_MAILBOX}/events/${encodeURIComponent(storedId.slice(STORED_EVENT_PREFIX.length))}`;
  }
  // Previously published routes still belong to their original publisher.
  return `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(storedId)}`;
}

export function routeCalendarAccessError(status: number): string | null {
  if (status === 401) return 'Calendar access expired. Sign out and back in, then publish again.';
  if (status === 403) return 'Cannot publish to the Operations calendar. Sign out and back in to grant shared-calendar access. Your Microsoft account also needs permission to edit operations@highdesertpm.com’s calendar. No event was added to your personal calendar.';
  return null;
}
