/**
 * The website's owner-lead board API (hdpm-web /api/os/leads?view=board&type=owner
 * and PATCH /api/os/leads/[id]). The one typed copy of that contract in hdpm-os:
 * if the website changes the shape, change it here.
 */

export type Person = { id: number; name: string };

export const LEAD_TOWNS = ['Bend', 'Redmond', 'Sisters', 'Prineville', 'Culver', 'Other'] as const;

export interface BoardLead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  leadType: string | null;
  source: string | null;
  assignedTo: Person | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  isDuplicateOfLeadId: number | null;
  expectedDoors: number | null;
  sourceDetail: string | null;
  town: string | null;
  propertyAddress: string | null;
  /** When the lead entered its current status (ISO). Days in stage = now − this. */
  statusEnteredAt: string;
  /** Statuses the website will accept from the current one. */
  allowedStatuses: string[];
}

export interface BoardResponse {
  leads: BoardLead[];
  users: Person[];
  totalDocs: number;
  /** True when the website capped the list (1000 leads). */
  truncated: boolean;
}

/** PATCH /api/os/leads/[id] body. Omit a field to leave it alone; null clears it. */
export interface LeadPatch {
  status?: string;
  expectedDoors?: number | null;
  assignedTo?: number | null;
  nextFollowUpAt?: string | null;
}

export interface LeadPatchResponse {
  lead: BoardLead;
}

/**
 * GET /api/os/leads/[id]: the side panel reads only these fields. Unlike the
 * board feed and PATCH, the detail keeps the property nested in subjectProperty
 * (no flat propertyAddress / town); use detailProperty() in board.ts.
 */
export interface LeadDetail extends Omit<BoardLead, 'town' | 'propertyAddress'> {
  subjectProperty: { address?: string | null; town?: string | null } | null;
  stageReason: string | null;
  notesSummary: string | null;
  message: string | null;
  lastContactedAt: string | null;
}

export interface LeadDetailResponse {
  lead: LeadDetail;
  activities: { id: number; type: string; direction: string | null; body: string; performedBy: string | null; createdAt: string }[];
}

/** Website path (relative to /api/os) for the board feed. */
export const BOARD_FEED_PATH = '/leads?view=board&type=owner';

export const SOURCE_LABELS: Record<string, string> = {
  zillow: 'Zillow',
  apartments_com: 'Apartments.com',
  website: 'Website',
  facebook: 'Facebook',
  instagram: 'Instagram',
  phone: 'Phone',
  walk_in: 'Walk-in',
  referral: 'Referral',
  other: 'Other',
};
