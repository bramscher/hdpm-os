import type { HdmsInvoice, LineItem, LineItemType } from './invoices';

export class CreditValidationError extends Error {}

/** Credit magnitudes are positive here; createCredit stores their negative equivalents. */
export function normalizeCreditItems(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) throw new CreditValidationError('Add at least one credit item.');
  let total = 0, labor = 0, materials = 0;
  const line_items: LineItem[] = value.map((item, index) => {
    if (!item || typeof item.description !== 'string' || !item.description.trim()) throw new CreditValidationError(`Enter a description for credit item ${index + 1}.`);
    const type: LineItemType = item.type || 'other';
    if (!['labor', 'materials', 'appliance', 'other'].includes(type)) throw new CreditValidationError(`Choose a valid type for credit item ${index + 1}.`);
    const cents = Math.round(Number(item.amount) * 100);
    if (!Number.isFinite(Number(item.amount)) || !Number.isSafeInteger(cents) || cents <= 0) throw new CreditValidationError(`Enter an amount greater than zero for credit item ${index + 1}.`);
    total += cents;
    if (type === 'labor') labor += cents;
    if (type === 'materials' || type === 'appliance') materials += cents;
    return { ...item, description: item.description.trim(), type, amount: cents / 100 };
  });
  if (!Number.isSafeInteger(total)) throw new CreditValidationError('The credit total is too large.');
  return { line_items, total_amount: total / 100, labor_amount: labor / 100, materials_amount: materials / 100 };
}

export function creditItemsForInvoice(invoice: Pick<HdmsInvoice, 'line_items' | 'total_amount' | 'invoice_code'>): LineItem[] {
  const items = (invoice.line_items || []).filter(item => Number(item.amount) > 0).map(item => ({
    description: `Credit: ${item.description || invoice.invoice_code}`,
    type: item.type || 'labor' as LineItemType,
    amount: Number(item.amount),
  }));
  const cents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0);
  if (items.length && cents === Math.round(Math.abs(Number(invoice.total_amount)) * 100)) return items;
  return [{ description: `Credit for ${invoice.invoice_code}`, type: 'other', amount: Math.abs(Number(invoice.total_amount)) || 0 }];
}

/** Net invoice charges after non-void linked credits; intentionally excludes payments. */
export function creditBalancePreview(
  invoice: Pick<HdmsInvoice, 'id' | 'total_amount'>,
  invoices: Pick<HdmsInvoice, 'doc_type' | 'credits_invoice_id' | 'status' | 'total_amount'>[],
  proposedAmount: number,
) {
  const originalCents = Math.round(Number(invoice.total_amount) * 100);
  const existingCents = invoices
    .filter(credit => credit.doc_type === 'credit' && credit.credits_invoice_id === invoice.id && credit.status !== 'void')
    .reduce((sum, credit) => sum + Math.round(Math.abs(Number(credit.total_amount)) * 100), 0);
  return { original: originalCents / 100, existingCredits: existingCents / 100, net: (originalCents - existingCents - Math.round(proposedAmount * 100)) / 100 };
}
