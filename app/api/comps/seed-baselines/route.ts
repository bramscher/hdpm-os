import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { bulkUpsertBaselines } from '@/lib/comps';
import type { UpsertBaselineInput } from '@/types/comps';

/**
 * POST /api/comps/seed-baselines
 *
 * Seeds HUD FMR baseline data for Central Oregon.
 * Data from https://www.ushousingdata.com/fair-market-rents/oregon
 * This is a one-time or annual operation — FMR values change once per year.
 */
// Support both GET (browser visit) and POST
export async function GET(request: NextRequest) {
  return seedBaselines(request);
}

export async function POST(request: NextRequest) {
  return seedBaselines(request);
}

async function seedBaselines(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email?.endsWith('@highdesertpm.com')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // FY2025 HUD Fair Market Rents for Central Oregon
    // Source: HUD FMR Documentation System + ushousingdata.com
    const baselines: UpsertBaselineInput[] = [
      // Deschutes County → Bend, Redmond, Sisters
      // FY2025 FMR values
      { area_name: 'Bend', county: 'Deschutes', bedrooms: 0, fmr_rent: 1285, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Bend', county: 'Deschutes', bedrooms: 1, fmr_rent: 1318, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Bend', county: 'Deschutes', bedrooms: 2, fmr_rent: 1667, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Bend', county: 'Deschutes', bedrooms: 3, fmr_rent: 2336, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Bend', county: 'Deschutes', bedrooms: 4, fmr_rent: 2799, data_year: 2025, source: 'hud_fmr' },

      { area_name: 'Redmond', county: 'Deschutes', bedrooms: 0, fmr_rent: 1285, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Redmond', county: 'Deschutes', bedrooms: 1, fmr_rent: 1318, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Redmond', county: 'Deschutes', bedrooms: 2, fmr_rent: 1667, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Redmond', county: 'Deschutes', bedrooms: 3, fmr_rent: 2336, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Redmond', county: 'Deschutes', bedrooms: 4, fmr_rent: 2799, data_year: 2025, source: 'hud_fmr' },

      { area_name: 'Sisters', county: 'Deschutes', bedrooms: 0, fmr_rent: 1285, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Sisters', county: 'Deschutes', bedrooms: 1, fmr_rent: 1318, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Sisters', county: 'Deschutes', bedrooms: 2, fmr_rent: 1667, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Sisters', county: 'Deschutes', bedrooms: 3, fmr_rent: 2336, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Sisters', county: 'Deschutes', bedrooms: 4, fmr_rent: 2799, data_year: 2025, source: 'hud_fmr' },

      // Crook County → Prineville
      { area_name: 'Prineville', county: 'Crook', bedrooms: 0, fmr_rent: 862, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Prineville', county: 'Crook', bedrooms: 1, fmr_rent: 1000, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Prineville', county: 'Crook', bedrooms: 2, fmr_rent: 1257, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Prineville', county: 'Crook', bedrooms: 3, fmr_rent: 1761, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Prineville', county: 'Crook', bedrooms: 4, fmr_rent: 2111, data_year: 2025, source: 'hud_fmr' },

      // Jefferson County → Culver
      { area_name: 'Culver', county: 'Jefferson', bedrooms: 0, fmr_rent: 784, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Culver', county: 'Jefferson', bedrooms: 1, fmr_rent: 871, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Culver', county: 'Jefferson', bedrooms: 2, fmr_rent: 1143, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Culver', county: 'Jefferson', bedrooms: 3, fmr_rent: 1602, data_year: 2025, source: 'hud_fmr' },
      { area_name: 'Culver', county: 'Jefferson', bedrooms: 4, fmr_rent: 1798, data_year: 2025, source: 'hud_fmr' },
    ];

    const count = await bulkUpsertBaselines(baselines);

    return NextResponse.json({
      message: `HUD FMR baselines seeded: ${count} records`,
      count,
    });
  } catch (error) {
    console.error('[Seed] Baseline seed error:', error);
    const message = error instanceof Error ? error.message : 'Seed failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
