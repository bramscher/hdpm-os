/**
 * Saved Craigslist Listings — CRUD + posting lifecycle.
 *
 * Lifecycle: draft (generated copy saved) → posted (staff pasted the live
 * Craigslist URL) → archived (leased / taken down). While posted, staff log
 * 48-hour renewals; the UI derives renew-due / expiring / expired from
 * posted_at + last_renewed_at (Craigslist posts expire ~30 days).
 */

import { getSupabaseAdmin } from './supabase';

export type ListingStatus = 'draft' | 'posted' | 'archived';

export interface SavedListing {
  id: string;
  appfolio_unit_id: string;
  address: string;
  city: string;
  state: string;
  zip: string | null;
  bedrooms: number;
  bathrooms: number | null;
  sqft: number | null;
  monthly_rent: number;
  unit_type: string | null;
  amenities: string[] | null;
  available_date: string | null;
  listing_title: string;
  listing_body: string;
  rently_enabled: boolean;
  rently_url: string | null;
  status: ListingStatus;
  craigslist_url: string | null;
  posted_at: string | null;
  posted_by: string | null;
  last_renewed_at: string | null;
  renewal_count: number;
  archived_at: string | null;
  archive_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SaveListingInput {
  appfolio_unit_id: string;
  address: string;
  city: string;
  state: string;
  zip?: string;
  bedrooms: number;
  bathrooms?: number;
  sqft?: number;
  monthly_rent: number;
  unit_type?: string;
  amenities?: string[];
  available_date?: string;
  listing_title: string;
  listing_body: string;
  rently_enabled: boolean;
  rently_url?: string;
  created_by: string;
}

export async function saveListing(input: SaveListingInput): Promise<SavedListing> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_listings')
    .insert({
      appfolio_unit_id: input.appfolio_unit_id,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip ?? null,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms ?? null,
      sqft: input.sqft ?? null,
      monthly_rent: input.monthly_rent,
      unit_type: input.unit_type ?? null,
      amenities: input.amenities ?? null,
      available_date: input.available_date ?? null,
      listing_title: input.listing_title,
      listing_body: input.listing_body,
      rently_enabled: input.rently_enabled,
      rently_url: input.rently_url ?? null,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving listing:', error);
    throw new Error(`Failed to save listing: ${error.message}`);
  }

  return data as SavedListing;
}

export async function listSavedListings(limit = 50): Promise<SavedListing[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_listings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error listing saved listings:', error);
    throw new Error(`Failed to list saved listings: ${error.message}`);
  }

  return data as SavedListing[];
}

export async function getSavedListing(id: string): Promise<SavedListing | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_listings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching saved listing:', error);
    throw new Error(`Failed to fetch saved listing: ${error.message}`);
  }

  return data as SavedListing;
}

/** Staff confirmed the listing is live on Craigslist — record the post URL. */
export async function markListingPosted(
  id: string,
  craigslistUrl: string,
  postedBy: string
): Promise<SavedListing> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_listings')
    .update({
      status: 'posted',
      craigslist_url: craigslistUrl,
      posted_at: new Date().toISOString(),
      posted_by: postedBy,
      // Posting starts the 48h renewal clock; a repost resets it.
      last_renewed_at: new Date().toISOString(),
      archived_at: null,
      archive_reason: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error marking listing posted:', error);
    throw new Error(`Failed to mark listing posted: ${error.message}`);
  }
  return data as SavedListing;
}

/** Staff renewed the post on Craigslist (allowed every 48 hours). */
export async function renewListing(id: string): Promise<SavedListing> {
  const supabase = getSupabaseAdmin();

  const { data: current, error: loadErr } = await supabase
    .from('saved_listings')
    .select('renewal_count')
    .eq('id', id)
    .single();
  if (loadErr) throw new Error(`Failed to load listing: ${loadErr.message}`);

  const { data, error } = await supabase
    .from('saved_listings')
    .update({
      last_renewed_at: new Date().toISOString(),
      renewal_count: ((current?.renewal_count as number) ?? 0) + 1,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error renewing listing:', error);
    throw new Error(`Failed to record renewal: ${error.message}`);
  }
  return data as SavedListing;
}

/** Post came down — unit leased, expired without repost, or pulled. */
export async function archiveListing(id: string, reason: string): Promise<SavedListing> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('saved_listings')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      archive_reason: reason,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error archiving listing:', error);
    throw new Error(`Failed to archive listing: ${error.message}`);
  }
  return data as SavedListing;
}

export async function deleteSavedListing(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('saved_listings')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting saved listing:', error);
    throw new Error(`Failed to delete saved listing: ${error.message}`);
  }
}
