import { jsPDF } from 'jspdf';
import { HdmsInvoice, LineItem, TECHNICIAN_INITIALS, normalizeTechnician } from './invoices';
import { HDPM_LOGO_BASE64 } from './hdpm-logo';

// ============================================
// Helpers
// ============================================

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================
// Colors
// ============================================
const BLACK = '#111111';
const DARK = '#333333';
const MID = '#666666';
const LABEL = '#888888';
const LIGHT_BORDER = '#e0e0e0';
const BG_GRAY = '#f5f5f5';
const GREEN = '#3d7a3d';
const BLUE_LABEL = '#4a6fa5';
const AMBER_LABEL = '#a5784a';

// ============================================
// Layout constants (US Letter: 612 x 792 pt)
// ============================================
const MARGIN = 50;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2; // 512
const FOOTER_ZONE = 80; // reserve this much at the bottom for footer

// ============================================
// Contact info
// ============================================
const PHONE = '541-548-0383';
const EMAIL = 'maintenance@highdesertpm.com';
const ADDRESS = '1515 SW Reindeer Ave, Redmond, OR 97756';

// ============================================
// PDF Generator
// ============================================

/**
 * Generate an invoice PDF buffer using jsPDF.
 * Returns a Node.js Buffer suitable for uploading to Supabase Storage.
 */
export function generateInvoicePdf(invoice: HdmsInvoice): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  let y = MARGIN;

  function checkPageBreak(needed: number) {
    if (y + needed > PAGE_H - FOOTER_ZONE) {
      drawFooter(doc);
      doc.addPage();
      y = MARGIN;
    }
  }

  // ── Header with Logo ────────────────────────
  const logoW = 80;
  const logoH = 52;
  doc.addImage(HDPM_LOGO_BASE64, 'PNG', MARGIN, y - 8, logoW, logoH);

  const textX = MARGIN + logoW + 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BLACK);
  doc.text('High Desert Maintenance Services', textX, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MID);
  doc.text('Division of High Desert Property Management', textX, y + 24);

  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text(`${ADDRESS}   |   ${PHONE}   |   ${EMAIL}`, textX, y + 38);

  y += logoH + 8;

  // Header divider
  doc.setDrawColor(GREEN);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 25;

  // ── Invoice Info Row ────────────────────────
  const infoBlockX = [MARGIN, MARGIN + 170, MARGIN + 340];
  let infoIdx = 0;

  drawInfoBlock(doc, infoBlockX[infoIdx], y, 'INVOICE NUMBER', String(invoice.invoice_code));
  infoIdx++;

  drawInfoBlock(doc, infoBlockX[infoIdx], y, 'DATE', formatDate(invoice.completed_date));
  infoIdx++;

  if (invoice.wo_reference) {
    drawInfoBlock(doc, infoBlockX[infoIdx], y, 'WORK ORDER', String(invoice.wo_reference));
  }
  y += 40;

  // ── Property Section (gray background) ──────
  const propBoxH = 55;
  doc.setFillColor(BG_GRAY);
  doc.roundedRect(MARGIN, y, CONTENT_W, propBoxH, 4, 4, 'F');

  const propPad = 12;
  let propY = y + propPad + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text('SERVICE LOCATION', MARGIN + propPad, propY);
  propY += 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(String(invoice.property_name), MARGIN + propPad, propY);
  propY += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#444444');
  doc.text(String(invoice.property_address), MARGIN + propPad, propY);

  y += propBoxH + 20;

  // ── Line Items Table ────────────────────────
  const lineItems: LineItem[] = invoice.line_items && invoice.line_items.length > 0
    ? invoice.line_items
    : [];

  // Only show the "DESCRIPTION OF WORK" block for legacy invoices without line items.
  // When line items exist, each row already has its own description column.
  if (lineItems.length === 0) {
    checkPageBreak(60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(LABEL);
    doc.text('DESCRIPTION OF WORK', MARGIN, y);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(DARK);
    const descLines = doc.splitTextToSize(String(invoice.description), CONTENT_W);
    for (let i = 0; i < descLines.length; i++) {
      checkPageBreak(14);
      doc.text(descLines[i], MARGIN, y);
      y += 14;
    }
    y += 8;
  }

  // Column layout: Type (55) | Description (flex) | Qty (45) | Price (65) | Extended (75)
  const COL_TYPE_W = 55;
  const COL_QTY_W = 45;
  const COL_PRICE_W = 65;
  const COL_EXT_W = 75;
  const COL_DESC_W = CONTENT_W - COL_TYPE_W - COL_QTY_W - COL_PRICE_W - COL_EXT_W;

  const COL_TYPE_X = MARGIN;
  const COL_DESC_X = COL_TYPE_X + COL_TYPE_W;
  const COL_QTY_X = COL_DESC_X + COL_DESC_W;
  const COL_PRICE_X = COL_QTY_X + COL_QTY_W;
  const COL_EXT_X = MARGIN + CONTENT_W; // right-aligned

  if (lineItems.length > 0) {
    // Check if any items have qty data (to decide whether to show qty/price columns)
    const hasQtyData = lineItems.some(li => li.qty && li.qty > 0);

    // Table header
    checkPageBreak(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(LABEL);
    doc.text('TYPE', COL_TYPE_X, y);
    doc.text('DESCRIPTION', COL_DESC_X, y);
    if (hasQtyData) {
      doc.text('QTY', COL_QTY_X + COL_QTY_W, y, { align: 'right' });
      doc.text('PRICE', COL_PRICE_X + COL_PRICE_W, y, { align: 'right' });
    }
    doc.text('AMOUNT', COL_EXT_X, y, { align: 'right' });
    y += 8;

    doc.setDrawColor(DARK);
    doc.setLineWidth(2);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 12;

    // Line item rows
    let laborSubtotal = 0;
    let materialsSubtotal = 0;

    for (const item of lineItems) {
      const amount = Number(item.amount) || 0;
      const type = item.type || 'other';
      // Appliances are billed as materials on the owner-facing invoice; only the
      // marked-up `amount` is ever printed — cost/markup_pct stay internal.
      if (type === 'labor') laborSubtotal += amount;
      else if (type === 'materials' || type === 'appliance') materialsSubtotal += amount;

      // Wrap description text
      const descColW = hasQtyData ? COL_DESC_W - 6 : (CONTENT_W - COL_TYPE_W - COL_EXT_W - 6);
      const descWrapped = doc.splitTextToSize(item.description, descColW);
      const rowHeight = Math.max(descWrapped.length * 12, 14);

      checkPageBreak(rowHeight + 10);

      // Type label (colored)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      if (type === 'labor') doc.setTextColor(BLUE_LABEL);
      else if (type === 'materials' || type === 'appliance') doc.setTextColor(AMBER_LABEL);
      else doc.setTextColor(MID);
      // Labor lines carry the tech's initials (e.g. "Labor BB"); full names stay internal.
      const tech = type === 'labor' ? normalizeTechnician(item.technician) : '';
      const typeLabel = tech ? `${capitalize(type)} ${TECHNICIAN_INITIALS[tech]}` : capitalize(type);
      doc.text(typeLabel, COL_TYPE_X, y);

      // Description (wrapped)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(DARK);
      for (let i = 0; i < descWrapped.length; i++) {
        doc.text(descWrapped[i], COL_DESC_X, y + (i * 12));
      }

      // Qty and Unit Price
      if (hasQtyData && item.qty && item.qty > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(MID);
        doc.text(String(item.qty), COL_QTY_X + COL_QTY_W, y, { align: 'right' });

        if (item.unit_price && item.unit_price > 0) {
          doc.text(formatCurrency(item.unit_price), COL_PRICE_X + COL_PRICE_W, y, { align: 'right' });
        }
      }

      // Extended Amount
      if (amount > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(DARK);
        doc.text(formatCurrency(amount), COL_EXT_X, y, { align: 'right' });
      }

      y += rowHeight;

      // Row separator
      doc.setDrawColor(LIGHT_BORDER);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 10;
    }

    // ── Subtotals (if both labor and materials present) ──
    if (laborSubtotal > 0 && materialsSubtotal > 0) {
      checkPageBreak(45);
      y += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);

      doc.setTextColor(BLUE_LABEL);
      doc.text('Labor Subtotal', MARGIN + CONTENT_W - 160, y);
      doc.setTextColor(DARK);
      doc.text(formatCurrency(laborSubtotal), COL_EXT_X, y, { align: 'right' });
      y += 14;

      doc.setTextColor(AMBER_LABEL);
      doc.text('Materials Subtotal', MARGIN + CONTENT_W - 160, y);
      doc.setTextColor(DARK);
      doc.text(formatCurrency(materialsSubtotal), COL_EXT_X, y, { align: 'right' });
      y += 14;
    }
  } else {
    // ── Legacy Labor / Materials rows ────────
    checkPageBreak(60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(LABEL);
    doc.text('ITEM', MARGIN, y);
    doc.text('AMOUNT', MARGIN + CONTENT_W, y, { align: 'right' });
    y += 8;

    doc.setDrawColor(DARK);
    doc.setLineWidth(2);
    doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
    y += 14;

    if (Number(invoice.labor_amount) > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(DARK);
      doc.text('Labor', MARGIN, y);
      doc.text(formatCurrency(Number(invoice.labor_amount)), MARGIN + CONTENT_W, y, { align: 'right' });
      y += 8;
      doc.setDrawColor(LIGHT_BORDER);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 14;
    }

    if (Number(invoice.materials_amount) > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(DARK);
      doc.text('Materials', MARGIN, y);
      doc.text(formatCurrency(Number(invoice.materials_amount)), MARGIN + CONTENT_W, y, { align: 'right' });
      y += 8;
      doc.setDrawColor(LIGHT_BORDER);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 14;
    }
  }

  // ── Total Row ─────────────────────────────
  checkPageBreak(40);
  y += 4;
  doc.setDrawColor(DARK);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(BLACK);
  doc.text('Total', MARGIN, y);

  doc.setFontSize(14);
  doc.text(formatCurrency(Number(invoice.total_amount)), MARGIN + CONTENT_W, y, { align: 'right' });

  // ── Footer ──────────────────────────────────
  drawFooter(doc);

  // ── Output ──────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}

// ============================================
// Internal helpers
// ============================================

function drawInfoBlock(doc: jsPDF, x: number, y: number, label: string, value: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text(label, x, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(BLACK);
  doc.text(value, x, y + 16);
}

function drawFooter(doc: jsPDF) {
  const footerY = PAGE_H - FOOTER_ZONE + 40;
  doc.setDrawColor(GREEN);
  doc.setLineWidth(1);
  doc.line(MARGIN, footerY - 20, MARGIN + CONTENT_W, footerY - 20);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(LABEL);
  doc.text('Thank you for your business.', PAGE_W / 2, footerY - 4, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(LABEL);
  doc.text(
    `High Desert Maintenance Services   |   ${ADDRESS}   |   ${PHONE}   |   ${EMAIL}`,
    PAGE_W / 2,
    footerY + 10,
    { align: 'center' }
  );
}
