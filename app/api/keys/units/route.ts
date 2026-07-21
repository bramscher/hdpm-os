import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireStaffSession } from '@/lib/maintenance/api-auth';
import {
  fetchAppFolioPropertiesWithCustomFields,
  fetchAppFolioUnits,
  type AppFolioPropertyWithCustomFields,
  type AppFolioUnit,
} from '@/lib/appfolio';
import type { KeyUnitOption } from '@/types/keys';

export const maxDuration = 120;

/**
 * GET /api/keys/units?q= — AppFolio unit picker for the assign / link flows.
 * Results carry the active key numbers already on each unit so the UI can
 * warn before creating a second key record for the same unit.
 *
 * The AppFolio fetch (~1-2s) is cached in-memory for 10 minutes per lambda;
 * fine for a staff-facing picker.
 */

interface UnitCache {
  fetchedAt: number;
  units: AppFolioUnit[];
  properties: AppFolioPropertyWithCustomFields[];
}
let cache: UnitCache | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getUnitsAndProperties(): Promise<Pick<UnitCache, 'units' | 'properties'>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const [units, properties] = await Promise.all([
    fetchAppFolioUnits(),
    fetchAppFolioPropertiesWithCustomFields(),
  ]);
  cache = { fetchedAt: Date.now(), units, properties };
  return cache;
}

export async function GET(request: NextRequest) {
  const session = await requireStaffSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    if (q.length < 2) {
      return NextResponse.json({ units: [] });
    }

    const { units, properties } = await getUnitsAndProperties();
    const propsById = new Map(properties.map((p) => [p.appfolioPropertyId, p]));

    const matches = units
      .filter((u) => {
        const prop = u.propertyId ? propsById.get(u.propertyId) : undefined;
        if (prop?.hidden) return false;
        const haystack = [
          u.address1,
          u.address2,
          u.city,
          u.name,
          prop?.name,
          prop?.address1,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 25);

    // Annotate with key numbers already active on these units.
    const unitIds = matches.map((u) => u.id);
    const supabase = getSupabaseAdmin();
    const { data: assignments, error } = await supabase
      .from('key_assignment')
      .select('appfolio_unit_id, key_slot(key_number)')
      .in('appfolio_unit_id', unitIds)
      .is('released_at', null);
    if (error) throw new Error(error.message);

    const keysByUnit = new Map<string, number[]>();
    for (const a of (assignments || []) as Array<{
      appfolio_unit_id: string;
      key_slot: { key_number: number } | { key_number: number }[];
    }>) {
      const nums = (Array.isArray(a.key_slot) ? a.key_slot : [a.key_slot]).map(
        (s) => s.key_number
      );
      keysByUnit.set(a.appfolio_unit_id, [
        ...(keysByUnit.get(a.appfolio_unit_id) ?? []),
        ...nums,
      ]);
    }

    const result: KeyUnitOption[] = matches.map((u) => {
      const prop = u.propertyId ? propsById.get(u.propertyId) : undefined;
      return {
        appfolio_unit_id: u.id,
        appfolio_property_id: u.propertyId,
        property_name: prop?.name ?? null,
        address: [u.address1 || prop?.address1, u.address2 || prop?.address2]
          .filter(Boolean)
          .join(' '),
        city: u.city || prop?.city || null,
        active_key_numbers: (keysByUnit.get(u.id) ?? []).sort((a, b) => a - b),
      };
    });

    return NextResponse.json({ units: result });
  } catch (error) {
    console.error('[api/keys/units] error:', error);
    const message = error instanceof Error ? error.message : 'Unit search failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
