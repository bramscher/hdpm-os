import type { HdmsInvoice, UpdateInvoiceInput } from './invoices';

export function canIssueInvoices(role?: string): boolean {
  return ['admin', 'finance', 'maintenance', 'pm', 'manager'].includes(role ?? '');
}

export function canEditInvoiceDraft(role: string | undefined, email: string | null | undefined, invoice: Pick<HdmsInvoice, 'status' | 'created_by' | 'doc_type' | 'maintenance_job_id'>): boolean {
  if (canIssueInvoices(role)) return invoice.status !== 'void';
  return role === 'field' && !!email && invoice.status === 'draft' && invoice.doc_type === 'invoice'
    && !invoice.maintenance_job_id && invoice.created_by?.toLowerCase() === email.toLowerCase();
}

// Field drafts can carry work and proposed charges, never ownership, lifecycle,
// PDF, credit, or approved-workspace linkage changes.
export function invoiceDraftFields(body: Record<string, unknown>): UpdateInvoiceInput {
  const keys = ['property_name', 'property_address', 'wo_reference', 'completed_date', 'description',
    'labor_amount', 'materials_amount', 'total_amount', 'line_items', 'internal_notes'];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
}
