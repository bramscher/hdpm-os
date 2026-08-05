import { getSupabaseAdmin } from './supabase';
import { weekStartPacific, weeksBefore } from './eos/scorecard';

// ============================================
// Types
// ============================================

/** An individual billable line item on an invoice */
export interface LineItem {
  description: string;
  account?: string;        // GL account code from work order (e.g. "6500: Keys, Locks...")
  type?: LineItemType;     // categorization for the line item
  technician?: string;     // tech who performed this labor (e.g. "Brody" | "Alberto"); labor lines only
  qty?: number;            // quantity (hours for labor, count for materials)
  unit_price?: number;     // per-unit price (hourly rate for labor, per-item for materials)
  amount: number;          // extended amount charged to the owner (qty × unit_price, or manual entry)
  // ── Internal-only cost/markup (materials & appliance lines) ──────────
  // These NEVER appear on the owner-facing PDF — only `amount` (the marked-up
  // charge) is printed. They exist so the internal markup report can show margin.
  cost?: number;           // what HDMS actually paid for this line (total, not per-unit)
  markup_pct?: number;     // markup percentage applied on top of cost (e.g. 25 or 10)
}

/** Line-item categories. `appliance` is materials with its own default markup. */
export type LineItemType = 'labor' | 'materials' | 'other' | 'appliance';

/** Line types that carry a material cost and get marked up (vs. labor/other). */
export const MATERIAL_TYPES: readonly LineItemType[] = ['materials', 'appliance'];

/** Default markup percentage applied to cost, by line type. */
export const DEFAULT_MARKUP_PCT: Record<'materials' | 'appliance', number> = {
  materials: 25,
  appliance: 10,
};

/** Charge = cost marked up by the given percentage, rounded to cents. */
export function chargedFromCost(cost: number, markupPct: number): number {
  return Math.round(cost * (1 + markupPct / 100) * 100) / 100;
}

/** The recorded cost basis of a line (0 when no cost was entered). */
export function lineCost(li: LineItem): number {
  return li.cost != null && li.cost > 0 ? li.cost : 0;
}

/**
 * Markup captured on a line = charged amount − recorded cost.
 * Returns 0 for labor/other or any line with no cost recorded, so legacy
 * invoices (no cost basis) never report phantom markup.
 */
export function lineMarkup(li: LineItem): number {
  const type = li.type || 'labor';
  if (!MATERIAL_TYPES.includes(type)) return 0;
  const cost = lineCost(li);
  if (cost <= 0) return 0;
  return Math.round((li.amount - cost) * 100) / 100;
}

/** The two HDMS technicians labor can be attributed to. */
export const TECHNICIANS = ['Brody', 'Alberto'] as const;
export type Technician = (typeof TECHNICIANS)[number];

/** Initials shown on the customer-facing invoice/PDF (full names are reserved for internal reporting). */
export const TECHNICIAN_INITIALS: Record<Technician, string> = {
  Brody: 'BB',
  Alberto: 'AF',
};

// ============================================
// Weekly billable hours
// ============================================

/** Target band for in-house billable hours per week (Craig, 2026-08-05 — starting point). */
export const WEEKLY_HOURS_TARGET = { min: 30, max: 36 } as const;

/** Total labor hours on an invoice = sum of labor-line qty. */
export function invoiceLaborHours(inv: Pick<HdmsInvoice, 'line_items'>): number {
  return (inv.line_items ?? []).reduce(
    (sum, li) => ((li.type || 'labor') === 'labor' && li.qty && li.qty > 0 ? sum + li.qty : sum),
    0
  );
}

export interface WeeklyBillableHours {
  /** Current Pacific week's Monday (YYYY-MM-DD). */
  weekStart: string;
  /** Hours billed so far this week. */
  weekHours: number;
  /** Hours billed in the full prior week. */
  lastWeekHours: number;
  /** This week's hours by technician (labor lines with a technician set). */
  byTech: Record<string, number>;
}

/**
 * Weekly billable hours from invoice labor lines. An invoice's hours are
 * attributed wholly to the week of its completed_date (created_at fallback) —
 * per Craig, billables almost never span weeks, so no per-day allocation.
 * Void invoices are excluded; drafts count (the work happened — they just
 * haven't been generated yet).
 */
export function weeklyBillableHours(
  invoices: Pick<HdmsInvoice, 'status' | 'line_items' | 'completed_date' | 'created_at'>[],
  now: Date = new Date()
): WeeklyBillableHours {
  const weekStart = weekStartPacific(now);
  const lastWeekStart = weeksBefore(weekStart, 1);
  const nextWeekStart = weeksBefore(weekStart, -1);

  let weekHours = 0;
  let lastWeekHours = 0;
  const byTech: Record<string, number> = {};

  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const day = (inv.completed_date ?? inv.created_at ?? '').slice(0, 10);
    if (!day) continue;
    if (day >= weekStart && day < nextWeekStart) {
      for (const li of inv.line_items ?? []) {
        if ((li.type || 'labor') !== 'labor' || !li.qty || li.qty <= 0) continue;
        weekHours += li.qty;
        const tech = li.technician?.trim();
        if (tech) byTech[tech] = (byTech[tech] ?? 0) + li.qty;
      }
    } else if (day >= lastWeekStart && day < weekStart) {
      lastWeekHours += invoiceLaborHours(inv);
    }
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    weekStart,
    weekHours: round1(weekHours),
    lastWeekHours: round1(lastWeekHours),
    byTech: Object.fromEntries(Object.entries(byTech).map(([k, v]) => [k, round1(v)])),
  };
}

/** Normalize an arbitrary assigned-tech string (name, email, casing) to a known technician, or "" if unknown. */
export function normalizeTechnician(raw: string | null | undefined): Technician | '' {
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s.includes('brody')) return 'Brody';
  if (s.includes('alberto')) return 'Alberto';
  return '';
}

/** Staff never shown as an assigned tech (per Craig, 2026-07-22). Matched case-insensitively. */
const EXCLUDED_ASSIGNEES = ['casy toney', 'casey toney'];

export function isExcludedAssignee(name: string | null | undefined): boolean {
  if (!name) return false;
  const s = name.trim().toLowerCase();
  return EXCLUDED_ASSIGNEES.some((x) => s.includes(x));
}

/**
 * Assignee name as shown in the UI: the canonical technician name when
 * recognized, else the raw string; null when empty or excluded.
 */
export function displayAssignee(raw: string | null | undefined): string | null {
  if (!raw?.trim() || isExcludedAssignee(raw)) return null;
  return normalizeTechnician(raw) || raw.trim();
}

export interface HdmsInvoice {
  id: string;
  invoice_number: number;
  invoice_code: string;
  status: 'draft' | 'generated' | 'attached' | 'void';
  property_name: string;
  property_address: string;
  wo_reference: string | null;
  work_order_id: string | null;
  /**
   * Staff member on the underlying work order (derived at fetch time, not a
   * DB column): work_orders.assigned_to via work_order_id, falling back to a
   * wo_reference → wo_number match, then to the labor lines' technician.
   */
  assigned_tech: string | null;
  completed_date: string | null;
  description: string;
  labor_amount: number;
  materials_amount: number;
  total_amount: number;
  line_items: LineItem[] | null;
  internal_notes: string | null;
  pdf_path: string | null;
  /** Set when this invoice has been reconciled to a trust-account payment (see lib/payments.ts). */
  payment_id: string | null;
  /**
   * AppFolio billing comparison (derived at fetch time by lib/af-bills.ts
   * attachAfBillsToInvoices, not DB columns): sum/count of matched AppFolio
   * bills and whether the amounts agree ('match' | 'mismatch' | 'unbilled').
   */
  af_billed_total?: number | null;
  af_bill_count?: number;
  af_bill_status?: 'match' | 'mismatch' | 'unbilled' | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceInput {
  property_name: string;
  property_address: string;
  wo_reference?: string;
  work_order_id?: string;
  completed_date?: string;
  description: string;
  labor_amount: number;
  materials_amount: number;
  total_amount: number;
  line_items?: LineItem[];
  internal_notes?: string;
  created_by: string;
}

export interface UpdateInvoiceInput {
  status?: HdmsInvoice['status'];
  property_name?: string;
  property_address?: string;
  wo_reference?: string;
  completed_date?: string;
  description?: string;
  labor_amount?: number;
  materials_amount?: number;
  total_amount?: number;
  line_items?: LineItem[];
  internal_notes?: string;
  pdf_path?: string;
}

/** Represents a parsed work order row (from CSV, PDF scan, or AppFolio API) */
export interface WorkOrderRow {
  wo_number: string;
  property_name: string;
  property_address: string;
  unit: string;
  description: string;
  completed_date: string;
  category: string;
  assigned_to: string;
  work_order_id?: string;
  // Scanned fields
  line_items?: LineItem[];
  task_items?: string[];           // individual tasks from the Description section
  technician?: string;
  technician_notes?: string;       // detailed paragraph notes from "Technician's Notes" section
  status?: string;
  created_date?: string;
  scheduled_date?: string;
  permission_to_enter?: string;
  maintenance_limit?: string;
  pets?: string;
  estimate_amount?: string;
  vendor_instructions?: string;
  property_notes?: string;
  created_by?: string;
  // Legacy aggregate amounts (still supported)
  labor_amount?: string;
  materials_amount?: string;
  total_amount?: string;
  [key: string]: string | string[] | LineItem[] | undefined;
}

// ============================================
// Database Operations
// ============================================

export async function createInvoice(input: CreateInvoiceInput): Promise<HdmsInvoice> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_invoices')
    .insert({
      property_name: input.property_name,
      property_address: input.property_address,
      wo_reference: input.wo_reference || null,
      work_order_id: input.work_order_id || null,
      completed_date: input.completed_date || null,
      description: input.description,
      labor_amount: input.labor_amount,
      materials_amount: input.materials_amount,
      total_amount: input.total_amount,
      line_items: input.line_items?.length ? input.line_items : null,
      internal_notes: input.internal_notes || null,
      created_by: input.created_by,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating invoice:', error);
    throw new Error(`Failed to create invoice: ${error.message}`);
  }

  return data as HdmsInvoice;
}

export async function getInvoices(limit = 50, offset = 0): Promise<HdmsInvoice[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('Error fetching invoices:', error);
    throw new Error(`Failed to fetch invoices: ${error.message}`);
  }

  return attachAssignedTech(data as HdmsInvoice[]);
}

// `.in()` filters go into the request query string, so keep chunks well under
// URL-length limits (and under PostgREST's 1000-row default cap).
const WO_LOOKUP_CHUNK = 500;

/**
 * Populate `assigned_tech` on each invoice from its work order's assigned_to
 * (by work_order_id, else wo_reference → wo_number), falling back to the labor
 * lines' technician. Lookup failures degrade to the line-item fallback rather
 * than failing the fetch.
 */
async function attachAssignedTech(invoices: HdmsInvoice[]): Promise<HdmsInvoice[]> {
  const supabase = getSupabaseAdmin();

  const ids = [...new Set(invoices.map((i) => i.work_order_id).filter((v): v is string => !!v))];
  const refs = [
    ...new Set(
      invoices
        .filter((i) => !i.work_order_id && i.wo_reference)
        .map((i) => i.wo_reference as string)
    ),
  ];

  const byId = new Map<string, string | null>();
  const byWoNumber = new Map<string, string | null>();

  for (let c = 0; c < ids.length; c += WO_LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('id, assigned_to')
      .in('id', ids.slice(c, c + WO_LOOKUP_CHUNK));
    if (error) console.error('Work-order assigned_to lookup failed:', error);
    for (const wo of data ?? []) byId.set(wo.id, wo.assigned_to);
  }
  for (let c = 0; c < refs.length; c += WO_LOOKUP_CHUNK) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('wo_number, assigned_to')
      .in('wo_number', refs.slice(c, c + WO_LOOKUP_CHUNK));
    if (error) console.error('Work-order assigned_to lookup failed:', error);
    for (const wo of data ?? []) if (wo.wo_number) byWoNumber.set(wo.wo_number, wo.assigned_to);
  }

  return invoices.map((inv) => {
    const raw = inv.work_order_id
      ? byId.get(inv.work_order_id)
      : inv.wo_reference
        ? byWoNumber.get(inv.wo_reference)
        : null;
    return { ...inv, assigned_tech: deriveAssignedTech(raw, inv.line_items) };
  });
}

/**
 * Best staff attribution for an invoice: a recognized technician from the WO
 * assignment, else from the labor lines, else the raw WO assignee string
 * (covers staff beyond the TECHNICIANS list), else the raw labor-line name.
 */
function deriveAssignedTech(
  rawAssigned: string | null | undefined,
  lineItems: LineItem[] | null
): string | null {
  const woRaw = isExcludedAssignee(rawAssigned) ? null : rawAssigned;
  const fromWo = normalizeTechnician(woRaw);
  if (fromWo) return fromWo;

  const rawLaborTech = lineItems?.find(
    (li) => (li.type || 'labor') === 'labor' && li.technician?.trim()
  )?.technician;
  const laborTech = isExcludedAssignee(rawLaborTech) ? null : rawLaborTech;
  const fromLabor = normalizeTechnician(laborTech);
  if (fromLabor) return fromLabor;

  if (woRaw?.trim()) return woRaw.trim();
  if (laborTech?.trim()) return laborTech.trim();
  return null;
}

export async function getInvoiceById(id: string): Promise<HdmsInvoice | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Error fetching invoice:', error);
    throw new Error(`Failed to fetch invoice: ${error.message}`);
  }

  const [invoice] = await attachAssignedTech([data as HdmsInvoice]);
  return invoice;
}

export async function updateInvoice(id: string, input: UpdateInvoiceInput): Promise<HdmsInvoice> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('hdms_invoices')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating invoice:', error);
    throw new Error(`Failed to update invoice: ${error.message}`);
  }

  return data as HdmsInvoice;
}

export async function deleteInvoice(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // First get the invoice to check for PDF to clean up
  const invoice = await getInvoiceById(id);
  if (!invoice) {
    throw new Error('Invoice not found');
  }

  // Delete PDF from storage if it exists
  if (invoice.pdf_path) {
    const { error: storageError } = await supabase.storage
      .from('hdms-invoices')
      .remove([invoice.pdf_path]);
    if (storageError) {
      console.error('Error deleting PDF from storage:', storageError);
      // Continue with invoice deletion even if storage cleanup fails
    }
  }

  // Delete the invoice record
  const { error } = await supabase
    .from('hdms_invoices')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting invoice:', error);
    throw new Error(`Failed to delete invoice: ${error.message}`);
  }
}

// ============================================
// Storage Operations
// ============================================

export async function uploadInvoicePdf(
  pdfBuffer: Uint8Array,
  invoice: HdmsInvoice
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const date = new Date(invoice.created_at);
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const sanitizedName = invoice.property_name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-');
  const dateStr = invoice.completed_date || date.toISOString().split('T')[0];

  const path = `${year}/${month}/${invoice.invoice_code}_${sanitizedName}_${dateStr}.pdf`;

  const { error } = await supabase.storage
    .from('hdms-invoices')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading PDF:', error);
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }

  return path;
}

export async function getInvoicePdfSignedUrl(path: string): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.storage
    .from('hdms-invoices')
    .createSignedUrl(path, 3600); // 1 hour expiry

  if (error) {
    console.error('Error creating signed URL:', error);
    throw new Error(`Failed to create download URL: ${error.message}`);
  }

  return data.signedUrl;
}
