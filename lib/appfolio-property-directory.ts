/**
 * AppFolio property_directory lookup keyed by v0 property UUID
 * (property_integration_id): the numeric web-app property id (for links like
 * https://highdesertpm.appfolio.com/properties/{id}) and the management end
 * date/reason. Covers visible properties only. Returns an empty map when the
 * Reports API isn't configured or the call fails, so callers treat links as
 * an enhancement.
 */

import { reportsApiConfigured, runReport } from '@/lib/appfolio-reports';

export interface DirectoryRow {
  property_id: number | string | null;
  property_integration_id: string | null;
  management_end_date: string | null;
  management_end_reason: string | null;
}

/**
 * Property-directory lookup keyed by v0 UUID: numeric web-app id (for links)
 * and management end date/reason (visible property + end date = offboarding).
 * Report covers visible properties only — hidden (lost) ones are deliberately
 * off the map for now.
 */
export async function fetchDirectoryByUuid(): Promise<Map<string, DirectoryRow>> {
  const byUuid = new Map<string, DirectoryRow>();
  if (!reportsApiConfigured()) return byUuid;
  try {
    const rows = await runReport<DirectoryRow>('property_directory', {
      columns: [
        'property_id',
        'property_integration_id',
        'management_end_date',
        'management_end_reason',
      ],
    });
    for (const row of rows) {
      if (row.property_integration_id) byUuid.set(row.property_integration_id, row);
    }
  } catch (err) {
    // Links and derived yellows are enhancements — the map works without them.
    console.error('[appfolio] property_directory fetch failed:', err);
  }
  return byUuid;
}
