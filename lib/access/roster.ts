import { isDepartedStaff } from '@/lib/staff-lifecycle';

// Suppress these identities from admin rosters without removing historical records.
const HIDDEN_ROSTER_IDENTITIES = new Set(['jaymen', 'jaymen@highdesertpm.com', 'bryce', 'bryce bramscher', 'bryce@highdesertpm.com']);

export function hiddenFromRoster(identity: string | null): boolean {
  return isDepartedStaff(identity) || HIDDEN_ROSTER_IDENTITIES.has((identity || '').trim().toLowerCase());
}
