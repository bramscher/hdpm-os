import type { Capabilities } from './staff-capabilities';
import type { HdmsInvoice, UpdateInvoiceInput } from './invoices';

export function canIssueInvoices(role?: string): boolean {
  return ['admin', 'finance', 'maintenance', 'pm', 'manager'].includes(role ?? '');
}

// Invoice-only access approved for Cheryl and Penny. This does not change
// their staff roles or grant company administration/timecard permissions.
export function isInvoiceCoordinator(email?: string | null): boolean {
  return ['cheryl@highdesertpm.com', 'penny@highdesertpm.com'].includes(email?.trim().toLowerCase() ?? '');
}

// Alberto prepares his own work-order drafts under his existing staff role.
export function canPrepareFieldInvoices(role?: string, email?: string | null): boolean {
  return role === 'field' || (role === 'staff' && email?.trim().toLowerCase() === 'alberto@highdesertpm.com');
}

export function canCreateInvoices(role?: string, email?: string | null, capabilities?: Capabilities): boolean {
  if (capabilities) return capabilities['invoice.draft'];
  return canIssueInvoices(role) || canPrepareFieldInvoices(role, email) || (role === 'staff' && isInvoiceCoordinator(email));
}

export function canGenerateInvoice(role: string | undefined, email?: string | null, invoice?: Pick<HdmsInvoice, 'status' | 'created_by' | 'doc_type' | 'maintenance_job_id'> | null, capabilities?: Capabilities): boolean {
  if (capabilities && (!capabilities['invoice.draft'] || !capabilities['invoice.generate'])) return false;
  if (canIssueInvoices(role)) return true;
  if (capabilities?.['invoice.generate']) return !invoice || canEditInvoiceDraft(role, email, invoice, capabilities);
  return role === 'staff' && isInvoiceCoordinator(email) && (!invoice || canEditInvoiceDraft(role, email, invoice));
}

export function canEditInvoiceDraft(role: string | undefined, email: string | null | undefined, invoice: Pick<HdmsInvoice, 'status' | 'created_by' | 'doc_type' | 'maintenance_job_id'>, capabilities?: Capabilities): boolean {
  if (capabilities && !capabilities['invoice.draft']) return false;
  if (canIssueInvoices(role)) return invoice.status !== 'void';
  return (capabilities?.['invoice.draft'] || canPrepareFieldInvoices(role, email) || (role === 'staff' && isInvoiceCoordinator(email))) && !!email && (invoice.status === 'draft' || (invoice.status === 'generated' && capabilities?.['invoice.generate'] === true)) && invoice.doc_type === 'invoice'
    && !invoice.maintenance_job_id && invoice.created_by?.toLowerCase() === email.toLowerCase();
}

// Field drafts can carry work and proposed charges, never ownership, lifecycle,
// PDF, credit, or approved-workspace linkage changes.
export function invoiceDraftFields(body: Record<string, unknown>): UpdateInvoiceInput {
  const keys = ['property_name', 'property_address', 'wo_reference', 'completed_date', 'description',
    'labor_amount', 'materials_amount', 'total_amount', 'line_items', 'internal_notes'];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(body, key)).map(key => [key, body[key]]));
}
