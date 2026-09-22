export function canAuthorEstimates(role?: string, email?: string | null): boolean {
  return ['admin','maintenance','pm','manager'].includes(role || '') ||
    (['staff','field'].includes(role || '') && ['alberto@highdesertpm.com','brody@highdesertpm.com','cheryl@highdesertpm.com'].includes(email?.trim().toLowerCase() || ''));
}
export function canIssueEstimates(role?: string): boolean {
  return ['admin','maintenance','pm','manager'].includes(role || '');
}
