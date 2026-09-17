// ============================================
// HDPM Rent Comparison Toolkit — Types
// ============================================

/** Supported Central Oregon towns */
export type Town = 'Bend' | 'Redmond' | 'Sisters' | 'Prineville' | 'Culver' | 'La Pine';

/** Property type classifications */
export type PropertyType = 'SFR' | 'Apartment' | 'Townhouse' | 'Duplex' | 'Condo' | 'Manufactured' | 'Other';

/** Data source identifiers */
export type DataSource = 'appfolio' | 'rentometer' | 'rentcast' | 'hud_fmr' | 'manual';

/** Common amenity tags */
export type Amenity =
  | 'garage'
  | 'pool'
  | 'ac'
  | 'washer_dryer'
  | 'dishwasher'
  | 'fenced_yard'
  | 'pet_friendly'
  | 'fireplace'
  | 'updated_kitchen'
  | 'new_flooring';

/** All towns available for filtering */
export const ALL_TOWNS: Town[] = ['Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver', 'La Pine'];

/** Shared city normalization for address lookup, AppFolio, and manual entry. */
export function detectCompTown(city: string): Town | null {
  const normalized = city.trim().toLowerCase().replace(/\s+/g, '');
  return ALL_TOWNS.find((town) => town.toLowerCase().replace(/\s+/g, '') === normalized) ?? null;
}

/** All property types available */
export const ALL_PROPERTY_TYPES: PropertyType[] = [
  'SFR', 'Apartment', 'Townhouse', 'Duplex', 'Condo', 'Manufactured', 'Other',
];

/** All data sources */
export const ALL_DATA_SOURCES: DataSource[] = ['appfolio', 'rentometer', 'rentcast', 'hud_fmr', 'manual'];

/** Human-readable labels for data sources */
export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  appfolio: 'AppFolio',
  rentometer: 'Rentometer',
  rentcast: 'RentCast',
  hud_fmr: 'HUD FMR',
  manual: 'Manual Entry',
};

/** Common amenities list for filter/form UI */
export const ALL_AMENITIES: { value: Amenity; label: string }[] = [
  { value: 'garage', label: 'Garage' },
  { value: 'pool', label: 'Pool' },
  { value: 'ac', label: 'A/C' },
  { value: 'washer_dryer', label: 'W/D' },
  { value: 'dishwasher', label: 'Dishwasher' },
  { value: 'fenced_yard', label: 'Fenced Yard' },
  { value: 'pet_friendly', label: 'Pet Friendly' },
  { value: 'fireplace', label: 'Fireplace' },
  { value: 'updated_kitchen', label: 'Updated Kitchen' },
  { value: 'new_flooring', label: 'New Flooring' },
];

// ============================================
// Database Row Types
// ============================================

/** A rental comp record from the database */
export interface RentalComp {
  id: string;
  town: Town;
  address: string | null;
  zip_code: string | null;
  bedrooms: number;
  bathrooms: number | null;
  sqft: number | null;
  property_type: PropertyType;
  amenities: string[];
  monthly_rent: number;
  rent_per_sqft: number | null;
  data_source: DataSource;
  comp_date: string;
  external_id: string | null;
  rentometer_percentile: number | null;
  rentometer_cached_until: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Input for creating a new rental comp */
export interface CreateCompInput {
  town: Town;
  address?: string;
  zip_code?: string;
  bedrooms: number;
  bathrooms?: number;
  sqft?: number;
  property_type: PropertyType;
  amenities?: string[];
  monthly_rent: number;
  rent_per_sqft?: number;
  data_source?: DataSource;
  comp_date?: string;
  external_id?: string;
  rentometer_percentile?: number;
  rentometer_cached_until?: string;
  notes?: string;
  created_by: string;
}

/** Input for updating a rental comp */
export interface UpdateCompInput {
  town?: Town;
  address?: string;
  zip_code?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  property_type?: PropertyType;
  amenities?: string[];
  monthly_rent?: number;
  rent_per_sqft?: number;
  data_source?: DataSource;
  comp_date?: string;
  external_id?: string;
  rentometer_percentile?: number;
  rentometer_cached_until?: string;
  notes?: string;
}

/** A market baseline record (HUD FMR / median rents) */
export interface MarketBaseline {
  id: string;
  area_name: string;
  county: string;
  bedrooms: number;
  fmr_rent: number | null;
  median_rent: number | null;
  data_year: number;
  source: string;
  created_at: string;
  updated_at: string;
}

/** Input for upserting a market baseline */
export interface UpsertBaselineInput {
  area_name: string;
  county: string;
  bedrooms: number;
  fmr_rent?: number;
  median_rent?: number;
  data_year: number;
  source?: string;
}

// ============================================
// Filter & Stats Types
// ============================================

/** Filter object for querying rental comps */
export interface CompsFilter {
  towns?: Town[];
  bedrooms?: number[];
  property_types?: PropertyType[];
  data_sources?: DataSource[];
  amenities?: string[];
  date_from?: string;
  date_to?: string;
  rent_min?: number;
  rent_max?: number;
  sqft_min?: number;
  sqft_max?: number;
}

/** Aggregated statistics for a filtered set of comps */
export interface CompsStats {
  count: number;
  avg_rent: number;
  median_rent: number;
  min_rent: number;
  max_rent: number;
  avg_sqft: number | null;
  avg_rent_per_sqft: number | null;
}

/** Stats broken down by town for charting */
export interface TownStats {
  town: Town;
  count: number;
  avg_rent: number;
  median_rent: number;
  min_rent: number;
  max_rent: number;
}

/** Rentometer API response shape */
export interface RentometerResult {
  mean: number;
  median: number;
  percentile_25: number;
  percentile_75: number;
  min: number;
  max: number;
  sample_size: number;
  address: string;
  city: string;
  state: string;
  bedrooms: number;
}

/** Sort options for the comps table */
export type CompsSortField = 'monthly_rent' | 'comp_date' | 'town' | 'bedrooms' | 'sqft' | 'property_type';
export type CompsSortDirection = 'asc' | 'desc';

export interface CompsSort {
  field: CompsSortField;
  direction: CompsSortDirection;
}

// ============================================
// Rent Analysis Report Types
// ============================================

/** Subject property for rent analysis */
export interface SubjectProperty {
  address: string;
  town: Town;
  zip_code?: string;
  bedrooms: number;
  bathrooms?: number;
  sqft?: number;
  property_type: PropertyType;
  amenities?: Amenity[];
  current_rent?: number;
  appfolio_property_id?: string;
}

/** A competing listing from Zillow or other external source */
export interface CompetingListing {
  address: string;
  price: number;
  bedrooms: number;
  bathrooms?: number;
  sqft?: number;
  listing_url?: string;
  source: 'zillow' | 'realtor' | 'apartments_com' | 'rentcast';
  days_on_market?: number;
  fetched_at: string;
}

/** Complete rent analysis result */
export interface RentAnalysis {
  subject: SubjectProperty;
  stats: CompsStats;
  comparable_comps: RentalComp[];
  competing_listings: CompetingListing[];
  baselines: MarketBaseline[];
  recommended_rent_low: number;
  recommended_rent_mid: number;
  recommended_rent_high: number;
  methodology_notes: string[];
  recommended_rent_override?: number;
  rentcast_value_estimate?: RentCastValueEstimate;
  rentcast_rent_estimate?: RentCastRentEstimate;
  prepared_for?: string;
  manager_notes?: string;
  generated_at: string;
  generated_by: string;
}

// ============================================
// Saved Rent Analysis
// ============================================

/** A saved rent analysis report (persisted in rent_analyses table) */
export interface SavedRentAnalysis {
  id: string;
  address: string;
  town: string;
  bedrooms: number;
  bathrooms: number | null;
  sqft: number | null;
  property_type: string;
  recommended_rent_low: number;
  recommended_rent_mid: number;
  recommended_rent_high: number;
  recommended_rent_override: number | null;
  prepared_for: string | null;
  owner_email: string | null;
  manager_notes: string | null;
  analysis_json: RentAnalysis;
  pdf_file_path: string | null;
  short_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// RentCast API Types
// ============================================

/** A comparable property returned by RentCast AVM endpoints */
export interface RentCastComparable {
  formattedAddress: string;
  city: string;
  state: string;
  zipCode: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  propertyType: string;
  price?: number;
  rent?: number;
  correlation: number;
  daysOld: number;
}

/** RentCast property value estimate (AVM) */
export interface RentCastValueEstimate {
  price: number;
  priceRangeLow: number;
  priceRangeHigh: number;
  comparables: RentCastComparable[];
}

/** RentCast rent estimate */
export interface RentCastRentEstimate {
  rent: number;
  rentRangeLow: number;
  rentRangeHigh: number;
  comparables: RentCastComparable[];
}

/** RentCast market statistics for a zip code */
export interface RentCastMarketStats {
  zipCode: string;
  medianRent: number;
  medianPrice: number;
  averageRent: number;
  averagePrice: number;
  rentalListingCount: number;
  saleListingCount: number;
}
