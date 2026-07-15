import { getSupabaseAdmin } from './supabase';

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

/** Normalize an arbitrary assigned-tech string (name, email, casing) to a known technician, or "" if unknown. */
export function normalizeTechnician(raw: string | null | undefined): Technician | '' {
  if (!raw) return '';
  const s = raw.toLowerCase();
  if (s.includes('brody')) return 'Brody';
  if (s.includes('alberto')) return 'Alberto';
  return '';
}

export interface HdmsInvoice {
  id: string;
  invoice_number: number;
  invoice_code: string;
  status: 'draft' | 'generated' | 'attached' | 'void';
  property_name: string;
  property_address: string;
  wo_reference: string | null;
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

  return data as HdmsInvoice[];
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

  return data as HdmsInvoice;
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
