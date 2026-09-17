/**
 * HUD Fair Market Rent (FMR) API Client
 *
 * Fetches annual FMR values by county for Central Oregon.
 * API docs: https://www.huduser.gov/portal/dataset/fmr-api.html
 *
 * County mapping:
 *   Deschutes County → Bend, Redmond, Sisters, La Pine
 *   Crook County → Prineville
 *   Jefferson County → Culver
 *
 * Required env vars:
 *   HUD_API_TOKEN
 */

import type { UpsertBaselineInput } from '@/types/comps';

// ============================================
// Config
// ============================================

const HUD_API_BASE = 'https://www.huduser.gov/hudapi/public/fmr';

// County FIPS codes (10-digit: SS + CCC + 00000) for Central Oregon
// Also try the Bend-Redmond MSA code for Deschutes County
const COUNTIES = [
  { fips: 'METRO13460M13460', name: 'Bend-Redmond MSA', county: 'Deschutes', type: 'msa' },
  { fips: '4101300099999', name: 'Crook County', county: 'Crook', type: 'county' },
  { fips: '4103100099999', name: 'Jefferson County', county: 'Jefferson', type: 'county' },
];

// Fallback FIPS if MSA doesn't work
const DESCHUTES_COUNTY_FIPS = '4101700099999';

// Area names to assign based on county
const COUNTY_AREAS: Record<string, string[]> = {
  Deschutes: ['Bend', 'Redmond', 'Sisters', 'La Pine'],
  Crook: ['Prineville'],
  Jefferson: ['Culver'],
};

function getToken(): string | null {
  const token = process.env.HUD_API_TOKEN;
  if (!token) {
    console.warn('[HUD] Missing API token — FMR sync will be skipped');
    return null;
  }
  return token;
}

// ============================================
// API Types
// ============================================

interface FmrBasicData {
  year?: number;
  Efficiency?: number;
  'One-Bedroom'?: number;
  'Two-Bedroom'?: number;
  'Three-Bedroom'?: number;
  'Four-Bedroom'?: number;
}

interface HudFmrResponse {
  data?: {
    basicdata?: FmrBasicData | FmrBasicData[];
    county_name?: string;
    metro_name?: string;
    year?: number;
  };
}

// ============================================
// Fetch FMR Data
// ============================================

async function fetchFmrData(
  entityId: string,
  year: number,
  token: string
): Promise<HudFmrResponse | null> {
  // Try /data/ endpoint (county/metro level)
  const url = `${HUD_API_BASE}/data/${entityId}?year=${year}`;
  console.log(`[HUD] Fetching: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[HUD] API error (${res.status}) for ${entityId}: ${text.substring(0, 200)}`);
    return null;
  }

  const json = await res.json();
  return json;
}

// ============================================
// Parse FMR values → bedroom map
// ============================================

function parseFmrValues(data: HudFmrResponse | null): Map<number, number> {
  const map = new Map<number, number>();
  if (!data?.data) return map;

  // basicdata can be an object or array depending on endpoint
  let bd: FmrBasicData | undefined;
  if (Array.isArray(data.data.basicdata)) {
    bd = data.data.basicdata[0];
  } else {
    bd = data.data.basicdata;
  }

  if (!bd) return map;

  if (bd.Efficiency) map.set(0, bd.Efficiency);
  if (bd['One-Bedroom']) map.set(1, bd['One-Bedroom']);
  if (bd['Two-Bedroom']) map.set(2, bd['Two-Bedroom']);
  if (bd['Three-Bedroom']) map.set(3, bd['Three-Bedroom']);
  if (bd['Four-Bedroom']) map.set(4, bd['Four-Bedroom']);
  return map;
}

// ============================================
// Public: Fetch All FMR Baselines
// ============================================

export async function fetchHudFmrBaselines(
  year?: number
): Promise<UpsertBaselineInput[]> {
  const token = getToken();
  if (!token) return [];

  const dataYear = year || new Date().getFullYear();
  const baselines: UpsertBaselineInput[] = [];

  for (const county of COUNTIES) {
    try {
      console.log(`[HUD] Fetching FMR for ${county.name} (${dataYear})...`);

      let response = await fetchFmrData(county.fips, dataYear, token);

      // If MSA didn't work for Deschutes, try county FIPS
      if (!response && county.county === 'Deschutes') {
        console.log(`[HUD] MSA lookup failed, trying county FIPS for Deschutes...`);
        response = await fetchFmrData(DESCHUTES_COUNTY_FIPS, dataYear, token);
      }

      const fmrValues = parseFmrValues(response);
      if (fmrValues.size === 0) {
        console.warn(`[HUD] No FMR data for ${county.name}`);
        continue;
      }

      // Create baseline entries for each area in this county
      const areas = COUNTY_AREAS[county.county] || [];
      for (const areaName of areas) {
        for (const [bedrooms, fmrRent] of fmrValues) {
          baselines.push({
            area_name: areaName,
            county: county.county,
            bedrooms,
            fmr_rent: fmrRent,
            data_year: dataYear,
            source: 'hud_fmr',
          });
        }
      }

      console.log(`[HUD] ${county.name}: ${fmrValues.size} bedroom levels mapped to ${areas.length} areas`);
    } catch (err) {
      console.error(`[HUD] Error fetching ${county.name}:`, err);
      // Continue with other counties
    }
  }

  console.log(`[HUD] Total baselines prepared: ${baselines.length}`);
  return baselines;
}
