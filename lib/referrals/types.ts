/**
 * Shared types for the referral partner portal (Batch 1+).
 * Column shapes mirror supabase/migrations/20260828_referrals_core.sql and
 * 20260828b_referral_partner_terms.sql.
 */

export const PARTNER_TYPES = ['owner', 'agent', 'builder', 'vendor', 'other'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_STATUSES = ['pending', 'active', 'paused', 'terminated'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const FEE_KINDS = ['one_time_bounty', 'trailing'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const BOUNTY_MODES = ['fixed', 'per_door'] as const;
export type BountyMode = (typeof BOUNTY_MODES)[number];

// Only agreement_signed is implementable in v1 (first_rent has no AppFolio
// detection source — plan §2).
export const BOUNTY_TRIGGERS = ['agreement_signed', 'first_rent'] as const;
export type BountyTrigger = (typeof BOUNTY_TRIGGERS)[number];

export interface ReferralPartner {
  id: string;
  org_id: string;
  auth_user_id: string | null;
  type: PartnerType;
  status: PartnerStatus;
  display_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  license_number: string | null;
  w9_status: string;
  w9_doc_path: string | null;
  legal_name: string | null;
  tax_id_last4: string | null;
  payout_method: string | null;
  payout_last4: string | null;
  agreement_accepted_at: string | null;
  referral_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeePolicyRow {
  id: string;
  org_id: string;
  partner_type: PartnerType;
  fee_kind: FeeKind;
  allowed: boolean;
  bounty_mode: BountyMode | null;
  bounty_amount: number | null;
  bounty_trigger: BountyTrigger | null;
  trailing_pct: number | null;
  trailing_months: number | null;
  effective_from: string;
  effective_to: string | null;
}

export interface PartnerTermsRow {
  id: string;
  org_id: string;
  partner_id: string;
  fee_kind: FeeKind;
  bounty_mode: BountyMode | null;
  bounty_amount: number | null;
  bounty_trigger: BountyTrigger | null;
  trailing_pct: number | null;
  trailing_months: number | null;
  active: boolean;
  set_by: string;
  created_at: string;
  updated_at: string;
}

// Lead lifecycle (plan §lead lifecycle). trailing_status is separate (Batch 6+).
export const LEAD_STAGES = [
  'submitted',
  'contacted',
  'qualified',
  'agreement_signed',
  'onboarding',
  'active',
  'closed',
  'lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const OPEN_LEAD_STAGES: LeadStage[] = [
  'submitted',
  'contacted',
  'qualified',
  'agreement_signed',
  'onboarding',
  'active',
];

export const LEAD_SOURCES = ['referral', 'organic'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface ReferralLead {
  id: string;
  org_id: string;
  partner_id: string | null;
  source: LeadSource;
  stage: LeadStage;
  trailing_status: string;
  prospect_name: string;
  prospect_email: string | null;
  prospect_phone: string | null;
  property_addresses: string[] | null;
  unit_count: number | null;
  notes: string | null;
  ref_code: string | null;
  utm: Record<string, unknown> | null;
  landing_page: string | null;
  hdpm_web_lead_id: string | null;
  appfolio_owner_id: string | null;
  appfolio_property_ids: string[] | null;
  doors_under_mgmt: number | null;
  dup_of_lead_id: string | null;
  dup_status: string | null;
  first_touch_at: string;
  created_at: string;
  updated_at: string;
}

export interface LeadEvent {
  id: number;
  lead_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}

export function isLeadStage(v: unknown): v is LeadStage {
  return typeof v === 'string' && (LEAD_STAGES as readonly string[]).includes(v);
}

export function isPartnerType(v: unknown): v is PartnerType {
  return typeof v === 'string' && (PARTNER_TYPES as readonly string[]).includes(v);
}
export function isFeeKind(v: unknown): v is FeeKind {
  return typeof v === 'string' && (FEE_KINDS as readonly string[]).includes(v);
}
export function isPartnerStatus(v: unknown): v is PartnerStatus {
  return typeof v === 'string' && (PARTNER_STATUSES as readonly string[]).includes(v);
}
