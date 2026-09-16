/** Departures confirmed by Craig on 2026-09-15. Keep historical attribution. */
const DEPARTED_IDENTITIES = new Set([
  'jayme', 'jen', 'jennifer bertran', 'bianca', 'bianca nyseth',
  'jayme@highdesertpm.com', 'jen@highdesertpm.com', 'bianca@highdesertpm.com',
]);

export function isDepartedStaff(identity: string | null | undefined): boolean {
  return !!identity && DEPARTED_IDENTITIES.has(identity.trim().toLowerCase());
}

/** Craig receives active work formerly routed to these staff. */
export function currentStaffOwner(identity: string): string {
  return isDepartedStaff(identity) ? 'Craig' : identity;
}
