import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getSupabaseAdmin } from '@/lib/supabase';

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
 * GET /api/properties/map
 *
 * One pin per property (units grouped by appfolio_property_id, falling back
 * to street address), with coordinates from the geocoded inspection_properties
 * rows and management status from property_mgmt_status. Properties without a
 * status row are 'active'.
 */
export async function GET() {
  const session = await getServerSession();
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
    const { data: statuses, error: statusError } = await supabase
      .from('property_mgmt_status')
      .select('appfolio_property_id, status, note');
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
      grouped.set(key, {
        key,
        appfolio_property_id: row.appfolio_property_id,
        name: row.name,
        address: row.address_2 ? `${row.address_1}, ${row.address_2}` : row.address_1,
        city: row.city,
        lat: row.latitude,
        lng: row.longitude,
        unit_count: 1,
        status: mgmt?.status || 'active',
        note: mgmt?.note || null,
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
