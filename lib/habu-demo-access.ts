/** Temporary, owner-only access while Craig reviews the HABU office demo. */
export function canViewHabuDemo(user: {
  email?: string | null;
  role?: string | null;
  isAdmin?: boolean;
} | null | undefined): boolean {
  return user?.email?.trim().toLowerCase() === 'craig@highdesertpm.com'
    && (user.role === 'admin' || user.isAdmin === true);
}
