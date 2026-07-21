/**
 * Key Manager — shared types.
 *
 * key_slot = permanent key number; key_assignment = one tenure of that number
 * at a unit (released_at null = active); key_type/key_copy = the physical
 * locks and copies for the active tenure; key_event = append-only history.
 */

export type KeySlotStatus = 'open' | 'assigned' | 'vacant' | 'retired';

export type KeyTransitionAction =
  | 'assign'
  | 'mark_vacant'
  | 'reissue'
  | 'release'
  | 'retire'
  | 'reinstate';

export type KeyCopyHolderType = 'tenant' | 'office' | 'vendor' | 'staff' | 'other';
export type KeyCopyStatus = 'issued' | 'returned' | 'lost' | 'destroyed';

export type KeySyncFlag =
  | 'appfolio_occupied_but_key_vacant'
  | 'appfolio_vacant_but_key_assigned'
  | 'unit_missing';

export interface KeySlot {
  id: string;
  key_number: number;
  status: KeySlotStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeyAssignment {
  id: string;
  key_slot_id: string;
  appfolio_unit_id: string | null;
  appfolio_property_id: string | null;
  property_name: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  owner_name: string | null;
  tenant_names: string[];
  unit_occupied: boolean | null;
  sync_flag: KeySyncFlag | null;
  last_synced_at: string | null;
  raw_address: string | null;
  assigned_at: string;
  assigned_by: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeyType {
  id: string;
  assignment_id: string;
  label: string;
  sort_order: number;
  notes: string | null;
  copies: KeyCopy[];
}

export interface KeyCopy {
  id: string;
  key_type_id: string;
  holder_type: KeyCopyHolderType;
  holder_name: string | null;
  status: KeyCopyStatus;
  issued_at: string | null;
  returned_at: string | null;
  charged: boolean;
  notes: string | null;
}

export interface KeyEvent {
  id: number;
  key_slot_id: string;
  assignment_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}

/** One row of the /keys list: slot + its active assignment (if any) + copy counts. */
export interface KeyListRow {
  id: string; // key_slot id
  key_number: number;
  status: KeySlotStatus;
  address: string | null;
  property_name: string | null;
  owner_name: string | null;
  tenant_names: string[];
  copies_out: number;
  copies_total: number;
  sync_flag: KeySyncFlag | null;
  unlinked: boolean; // active assignment exists but no appfolio_unit_id
  assigned_at: string | null;
}

export interface KeyStats {
  total: number;
  assigned: number;
  vacant: number;
  open: number;
  retired: number;
  flagged: number;
  unlinked: number;
}

/** Full detail payload for /keys/[id]. */
export interface KeyDetail {
  slot: KeySlot;
  active_assignment: KeyAssignment | null;
  key_types: KeyType[];
  past_assignments: KeyAssignment[];
  events: KeyEvent[];
}

/** Copy template used when assigning/reissuing (editable in the modal). */
export interface KeyCopyTemplateEntry {
  holder_type: KeyCopyHolderType;
  holder_name?: string | null;
  charged?: boolean;
}

export interface KeyTypeTemplateEntry {
  label: string;
  copies: KeyCopyTemplateEntry[];
}

/** AppFolio unit as returned by the unit picker endpoint. */
export interface KeyUnitOption {
  appfolio_unit_id: string;
  appfolio_property_id: string | null;
  property_name: string | null;
  address: string;
  city: string | null;
  active_key_numbers: number[];
}

// -----------------------------------------------------------------------------
// Import types
// -----------------------------------------------------------------------------

export type ImportRowClass = 'open' | 'matched' | 'unmatched' | 'error';

export interface KeyImportRowPreview {
  row_number: number;
  key_number: number | null;
  raw_address: string;
  owner: string;
  date_used: string | null;
  classification: ImportRowClass;
  appfolio_unit_id: string | null;
  matched_address: string | null;
  issues: string[];
}

export interface KeyImportPreview {
  total_rows: number;
  open: number;
  matched: number;
  unmatched: number;
  errors: number;
  rows: KeyImportRowPreview[];
}

export interface KeyImportCommitResult {
  slots_created: number;
  assignments_created: number;
  open_slots: number;
  batch_id: string;
}
