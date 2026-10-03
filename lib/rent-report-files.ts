/**
 * Storage path for a generated rent analysis PDF. Every generation gets its
 * own file: re-generating the same property on the same day used to
 * overwrite the earlier PDF (including one already linked to an owner) and
 * let the storage CDN keep serving the cached older copy for up to an hour.
 */
export function rentReportFileName(town: string, address: string, now: Date = new Date(), suffix?: string): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // 20261003T220752Z
  const safeAddress = address.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40);
  const safeTown = town.replace(/[^a-zA-Z0-9]/g, '_');
  const rand = suffix ?? Math.random().toString(36).slice(2, 6);
  return `reports/${year}/${month}/rent-analysis_${safeTown}_${safeAddress}_${stamp}_${rand}.pdf`;
}
