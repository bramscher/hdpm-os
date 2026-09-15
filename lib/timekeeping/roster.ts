/** Timekeeping-only roster exclusions use exact staff.person keys. */
export function participatesInTimekeeping(staffPerson: string): boolean {
  const excluded = (process.env.TIMEKEEPING_EXCLUDED_STAFF || "")
    .split(",")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
  return !excluded.includes(staffPerson.trim().toLowerCase());
}
