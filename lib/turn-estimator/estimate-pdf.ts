/**
 * Turn Estimator — owner-facing HDMS estimate PDF (jsPDF).
 *
 * HDMS (contractor) branding, matching the invoice PDF. COST-BLIND: only the
 * owner-facing prices (owner_unit_price / owner_extended) are ever printed —
 * internal_cost / margin / tenant allocation NEVER appear. Lines are grouped by
 * category, and the document carries assumptions + an approval line.
 */

import { jsPDF } from 'jspdf';
import { HDPM_LOGO_BASE64 } from '@/lib/hdpm-logo';

// Branding / layout (mirrors lib/invoice-pdf-template.ts).
const BLACK = '#111111';
const DARK = '#333333';
const MID = '#666666';
const LABEL = '#888888';
const LIGHT_BORDER = '#e0e0e0';
const BG_GRAY = '#f5f5f5';
const GREEN = '#3d7a3d';
const MARGIN = 50;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_ZONE = 80;
const PHONE = '541-548-0383';
const EMAIL = 'maintenance@highdesertpm.com';
const ADDRESS = '1515 SW Reindeer Ave, Redmond, OR 97756';

const CATEGORY_ORDER = [
  'inspection',
  'coordination',
  'cleaning',
  'painting',
  'flooring',
  'handyman',
  'appliances',
  'landscaping',
  'locks',
  'haul',
  'vendor',
  'other',
];
const CATEGORY_LABEL: Record<string, string> = {
  inspection: 'Inspection & Coordination',
  coordination: 'Inspection & Coordination',
  cleaning: 'Cleaning',
  painting: 'Painting',
  flooring: 'Flooring',
  handyman: 'Handyman / Maintenance',
  appliances: 'Appliances',
  landscaping: 'Landscaping / Exterior',
  locks: 'Locks / Security',
  haul: 'Haul-away',
  vendor: 'Vendor Work',
  other: 'Other',
};

export interface EstimatePdfLine {
  category: string | null;
  description: string;
  room: string | null;
  qty: number;
  uom: string;
  owner_unit_price: number;
  owner_extended: number;
}

export interface EstimatePdfInput {
  estimate_code: string; // e.g. EST-1a2b3c4d-v2
  property_name: string;
  property_address: string;
  unit_name: string | null;
  priced_asof: string; // YYYY-MM-DD
  owner_total: number;
  lines: EstimatePdfLine[];
  status: string; // estimate status (for the stamp)
}

function currency(n: number): string {
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}
function longDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
function catKey(c: string | null): string {
  const k = (c ?? 'other').toLowerCase();
  return CATEGORY_ORDER.includes(k) ? k : 'other';
}

export function generateEstimatePdf(input: EstimatePdfInput): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  let y = MARGIN;

  const footer = () => {
    const fy = PAGE_H - FOOTER_ZONE + 40;
    doc.setDrawColor(GREEN);
    doc.setLineWidth(1);
    doc.line(MARGIN, fy - 20, MARGIN + CONTENT_W, fy - 20);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(LABEL);
    doc.text('We appreciate the opportunity to prepare this estimate.', PAGE_W / 2, fy - 4, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
      `High Desert Maintenance Services   |   ${ADDRESS}   |   ${PHONE}   |   ${EMAIL}`,
      PAGE_W / 2,
      fy + 10,
      { align: 'center' }
    );
  };
  const pageBreak = (needed: number) => {
    if (y + needed > PAGE_H - FOOTER_ZONE) {
      footer();
      doc.addPage();
      y = MARGIN;
    }
  };

  // ── Header ──
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

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(GREEN);
  doc.text('ESTIMATE', MARGIN + CONTENT_W, y + 4, { align: 'right' });

  y += logoH + 8;
  doc.setDrawColor(GREEN);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 25;

  // ── Info blocks ──
  const infoX = [MARGIN, MARGIN + 170, MARGIN + 340];
  const infoBlock = (x: number, label: string, value: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(LABEL);
    doc.text(label, x, y);
    doc.setFontSize(12);
    doc.setTextColor(BLACK);
    doc.text(value, x, y + 16);
  };
  infoBlock(infoX[0], 'ESTIMATE NUMBER', input.estimate_code);
  infoBlock(infoX[1], 'DATE', longDate(input.priced_asof));
  infoBlock(infoX[2], 'STATUS', input.status.replace(/_/g, ' ').toUpperCase());
  y += 40;

  // ── Service location ──
  const boxH = 55;
  doc.setFillColor(BG_GRAY);
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 4, 4, 'F');
  let py = y + 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text('SERVICE LOCATION', MARGIN + 12, py);
  py += 14;
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(`${input.property_name}${input.unit_name ? ` — Unit ${input.unit_name}` : ''}`, MARGIN + 12, py);
  py += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor('#444444');
  doc.text(input.property_address || '', MARGIN + 12, py);
  y += boxH + 20;

  // ── Line items grouped by category ──
  const COL_QTY_W = 55;
  const COL_PRICE_W = 70;
  const COL_EXT_X = MARGIN + CONTENT_W;
  const COL_QTY_X = MARGIN + CONTENT_W - COL_QTY_W - COL_PRICE_W - 80;
  const COL_PRICE_X = MARGIN + CONTENT_W - COL_PRICE_W - 80;

  // Header row
  pageBreak(30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text('DESCRIPTION', MARGIN, y);
  doc.text('QTY', COL_QTY_X + 20, y, { align: 'right' });
  doc.text('PRICE', COL_PRICE_X + COL_PRICE_W, y, { align: 'right' });
  doc.text('AMOUNT', COL_EXT_X, y, { align: 'right' });
  y += 8;
  doc.setDrawColor(DARK);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 12;

  const grouped = new Map<string, EstimatePdfLine[]>();
  for (const l of input.lines) {
    const k = catKey(l.category);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(l);
  }
  const orderedKeys = CATEGORY_ORDER.filter((k) => grouped.has(k));
  // Any residual keys not in CATEGORY_ORDER already fold into 'other' via catKey.

  const seenLabels = new Set<string>();
  for (const key of orderedKeys) {
    const label = CATEGORY_LABEL[key] ?? 'Other';
    // Collapse coordination+inspection into one heading.
    if (!seenLabels.has(label)) {
      pageBreak(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(GREEN);
      doc.text(label, MARGIN, y);
      y += 14;
      seenLabels.add(label);
    }
    for (const l of grouped.get(key)!) {
      const descText = `${l.room ? `[${l.room}] ` : ''}${l.description}`;
      const wrapped = doc.splitTextToSize(descText, COL_QTY_X - MARGIN - 6);
      const rowH = Math.max(wrapped.length * 12, 14);
      pageBreak(rowH + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(DARK);
      wrapped.forEach((line: string, i: number) => doc.text(line, MARGIN, y + i * 12));
      doc.setFontSize(9);
      doc.setTextColor(MID);
      if (l.qty > 0) doc.text(`${l.qty} ${l.uom}`, COL_QTY_X + 20, y, { align: 'right' });
      if (l.owner_unit_price > 0) doc.text(currency(l.owner_unit_price), COL_PRICE_X + COL_PRICE_W, y, { align: 'right' });
      doc.setFontSize(10);
      doc.setTextColor(DARK);
      doc.text(currency(l.owner_extended), COL_EXT_X, y, { align: 'right' });
      y += rowH;
      doc.setDrawColor(LIGHT_BORDER);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
      y += 8;
    }
  }

  // ── Total ──
  pageBreak(40);
  y += 4;
  doc.setDrawColor(DARK);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(BLACK);
  doc.text('Estimated Total', MARGIN, y);
  doc.setFontSize(14);
  doc.text(currency(input.owner_total), MARGIN + CONTENT_W, y, { align: 'right' });
  y += 28;

  // ── Assumptions + approval ──
  pageBreak(120);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text('ASSUMPTIONS', MARGIN, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MID);
  const assumptions = [
    'This is an estimate based on the scope identified to date. Prices are effective as of the estimate date.',
    'Work discovered beyond this scope will be quoted separately; any increase beyond the approved amount requires written approval.',
    'Materials and vendor work are billed at the amounts shown. Estimate valid for 30 days.',
  ];
  for (const a of assumptions) {
    const wrapped = doc.splitTextToSize(`• ${a}`, CONTENT_W);
    wrapped.forEach((line: string) => {
      pageBreak(12);
      doc.text(line, MARGIN, y);
      y += 12;
    });
  }
  y += 16;

  pageBreak(50);
  doc.setDrawColor(DARK);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + 240, y);
  doc.line(MARGIN + 300, y, MARGIN + CONTENT_W, y);
  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text('OWNER APPROVAL (SIGNATURE)', MARGIN, y);
  doc.text('DATE', MARGIN + 300, y);

  footer();
  return Buffer.from(doc.output('arraybuffer'));
}
