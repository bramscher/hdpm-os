import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runReport, reportsApiConfigured } from '@/lib/appfolio-reports';

export type PropertyMgmtStatus = 'active' | 'offboarding' | 'lost';

export interface MapProperty {
  /** appfolio_property_id when present, else a synthetic address key */
  key: string;
  appfolio_property_id: string | null;
  name: string | null;
  address: string;
  city: string;
  lat: number;
  lng: number;
  unit_count: number;
  status: PropertyMgmtStatus;
  note: string | null;
  /** Web-app property page, when the numeric id is known */
  appfolio_url: string | null;
  management_end_date: string | null;
  management_end_reason: string | null;
  /** Active Haven leasing prospects interested in this property */
  prospects: number;
  hot_prospects: number;
}

interface DirectoryRow {
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
async function fetchDirectoryByUuid(): Promise<Map<string, DirectoryRow>> {
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
    console.error('[properties/map] property_directory fetch failed:', err);
  }
  return byUuid;
}

interface UnitRow {
  name: string | null;
  address_1: string;
  address_2: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  appfolio_property_id: string | null;
}

/**
 * Active Haven leasing prospects per AppFolio property (via the lead match
 * in haven_conversation). Empty map if the sync/migration isn't live yet.
 */
async function fetchProspectCounts(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<Map<string, { total: number; hot: number }>> {
  const counts = new Map<string, { total: number; hot: number }>();
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('haven_conversation')
        .select('appfolio_property_id, pipeline_phase, lead_classification')
        .not('appfolio_property_id', 'is', null)
        .neq('pipeline_phase', 'Inactive')
        .range(from, from + 999);
      if (error) return counts;
      for (const row of data || []) {
        const entry = counts.get(row.appfolio_property_id) || { total: 0, hot: 0 };
        entry.total++;
        if (row.lead_classification === 'Ready to Apply' || row.lead_classification === 'Urgency to Move') {
          entry.hot++;
        }
        counts.set(row.appfolio_property_id, entry);
      }
      if (!data || data.length < 1000) break;
    }
  } catch {
    // Haven table/columns not present yet — demand overlay just stays empty.
  }
  return counts;
}

/**
 * GET /api/properties/map
 *
 * One pin per property (units grouped by appfolio_property_id, falling back
 * to street address), with coordinates from the geocoded inspection_properties
 * rows and management status from property_mgmt_status. Properties without a
 * status row are 'active'.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Page through all units (Supabase caps a single select at 1000 rows).
    const rows: UnitRow[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('inspection_properties')
        .select('name, address_1, address_2, city, latitude, longitude, appfolio_property_id')
        .eq('geocode_status', 'success')
        // Legacy CSV-import rows have no AppFolio id and predate the sync —
        // the live portfolio is the synced rows only.
        .not('appfolio_property_id', 'is', null)
        .range(from, from + pageSize - 1);
      if (error) throw new Error(`Failed to fetch properties: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }

    // Management statuses — table may not exist until migration 20260727 runs.
    const statusMap = new Map<string, { status: PropertyMgmtStatus; note: string | null }>();
    const [{ data: statuses, error: statusError }, directory, prospectMap] = await Promise.all([
      supabase.from('property_mgmt_status').select('appfolio_property_id, status, note'),
      fetchDirectoryByUuid(),
      fetchProspectCounts(supabase),
    ]);
    if (!statusError) {
      for (const s of statuses || []) {
        statusMap.set(s.appfolio_property_id, { status: s.status, note: s.note });
      }
    }

    // Group units into properties.
    const grouped = new Map<string, MapProperty>();
    for (const row of rows) {
      if (row.latitude == null || row.longitude == null) continue;
      const key = row.appfolio_property_id || `addr:${row.address_1}|${row.city}`.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.unit_count += 1;
        continue;
      }
      const mgmt = row.appfolio_property_id ? statusMap.get(row.appfolio_property_id) : undefined;
      const dir = row.appfolio_property_id ? directory.get(row.appfolio_property_id) : undefined;
      // Manual status wins; else an AppFolio management end date means the
      // owner is on the way out; else actively managed.
      const status: PropertyMgmtStatus =
        mgmt?.status || (dir?.management_end_date ? 'offboarding' : 'active');
      grouped.set(key, {
        key,
        appfolio_property_id: row.appfolio_property_id,
        name: row.name,
        address: row.address_2 ? `${row.address_1}, ${row.address_2}` : row.address_1,
        city: row.city,
        lat: row.latitude,
        lng: row.longitude,
        unit_count: 1,
        status,
        note: mgmt?.note || null,
        appfolio_url: dir?.property_id
          ? `https://highdesertpm.appfolio.com/properties/${dir.property_id}`
          : null,
        management_end_date: dir?.management_end_date || null,
        management_end_reason: dir?.management_end_reason || null,
        prospects: row.appfolio_property_id
          ? prospectMap.get(row.appfolio_property_id)?.total || 0
          : 0,
        hot_prospects: row.appfolio_property_id
          ? prospectMap.get(row.appfolio_property_id)?.hot || 0
          : 0,
      });
    }

    const properties = [...grouped.values()];
    const counts = {
      active: properties.filter((p) => p.status === 'active').length,
      offboarding: properties.filter((p) => p.status === 'offboarding').length,
      lost: properties.filter((p) => p.status === 'lost').length,
    };

    return NextResponse.json({
      properties,
      counts,
      status_table_ready: !statusError,
    });
  } catch (error) {
    console.error('[properties/map] error:', error);
    const message = error instanceof Error ? error.message : 'Failed to load property map';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
