import type { Capabilities } from '@/lib/staff-capabilities';
export function canAuthorEstimates(role?: string, email?: string | null, capabilities?: Capabilities): boolean {
  if (capabilities) return capabilities['estimate.draft'];
  return ['admin','maintenance','pm','manager'].includes(role || '') ||
    (['staff','field'].includes(role || '') && ['alberto@highdesertpm.com','brody@highdesertpm.com','cheryl@highdesertpm.com'].includes(email?.trim().toLowerCase() || ''));
}
export function canIssueEstimates(role?: string, capabilities?: Capabilities): boolean {
  if (capabilities) return capabilities['estimate.draft'] && capabilities['estimate.issue'];
  return ['admin','maintenance','pm','manager'].includes(role || '');
}
