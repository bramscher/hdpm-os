/**
 * Rent Analysis Report — PDF Generator
 *
 * Generates a branded multi-page PDF report using jsPDF,
 * matching the HDPM invoice template style.
 */

import { jsPDF } from 'jspdf';
import { HDPM_LOGO_BASE64 } from './hdpm-logo';
import type { RentAnalysis, RentalComp, CompetingListing } from '@/types/comps';
import { listingSourceLabel } from './competing-listings';

// ============================================
// Helpers
// ============================================

function fmt(amount: number): string {
  return `$${Math.round(amount).toLocaleString()}`;
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================
// Colors (same as invoice template)
// ============================================
const BLACK = '#111111';
const DARK = '#333333';
const MID = '#666666';
const LABEL = '#888888';
const LIGHT_BORDER = '#e0e0e0';
const BG_GRAY = '#f5f5f5';
const GREEN = '#3d7a3d';
const WHITE = '#ffffff';

// ============================================
// Layout constants (US Letter: 612 x 792 pt)
// ============================================
const MARGIN = 50;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2; // 512
const FOOTER_Y = 750;

// ============================================
// Shared: Header + Footer
// ============================================

function drawHeader(doc: jsPDF): number {
  let y = MARGIN;

  // Logo
  const logoW = 80;
  const logoH = 52;
  doc.addImage(HDPM_LOGO_BASE64, 'PNG', MARGIN, y - 8, logoW, logoH);

  // Company name
  const textX = MARGIN + logoW + 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(BLACK);
  doc.text('High Desert Property Management', textX, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MID);
  doc.text('Central Oregon Rental Market Analysis', textX, y + 24);

  // Contact info
  doc.setFontSize(8);
  doc.setTextColor(LABEL);
  doc.text(
    '1515 SW Reindeer Ave, Redmond, OR 97756   |   541-548-0383   |   info@highdesertpm.com',
    textX,
    y + 38
  );

  y += logoH + 8;

  // Green divider
  doc.setDrawColor(GREEN);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 20;

  return y;
}

function drawFooter(doc: jsPDF, pageNum: number, totalPages: number): void {
  // Green line
  doc.setDrawColor(GREEN);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, FOOTER_Y, MARGIN + CONTENT_W, FOOTER_Y);

  // Disclaimer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(LABEL);
  doc.text(
    'This report is for informational purposes only and does not constitute a guarantee of rental income.',
    MARGIN,
    FOOTER_Y + 10
  );
  doc.text(
    'Market conditions may vary. High Desert Property Management   |   highdesertpm.com',
    MARGIN,
    FOOTER_Y + 19
  );

  // Page number
  doc.setFontSize(7);
  doc.text(
    `Page ${pageNum} of ${totalPages}`,
    MARGIN + CONTENT_W - 50,
    FOOTER_Y + 19
  );
}

function checkPageBreak(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > FOOTER_Y - 20) {
    doc.addPage();
    return drawHeader(doc);
  }
  return y;
}

// ============================================
// Helpers: Draw Elements
// ============================================

function drawSectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(GREEN);
  doc.text(title, MARGIN, y);
  y += 6;
  doc.setDrawColor(GREEN);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 14;
  return y;
}

function drawLabel(doc: jsPDF, x: number, y: number, label: string): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(LABEL);
  doc.text(label, x, y);
}

function drawValue(doc: jsPDF, x: number, y: number, value: string, size = 11): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(BLACK);
  doc.text(value, x, y);
}

// ============================================
// PDF Generator
// ============================================

export function generateRentReportPdf(analysis: RentAnalysis): Buffer {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
  });

  const { subject, stats, comparable_comps, competing_listings, baselines, methodology_notes } =
    analysis;

  const hasZillow = competing_listings.length > 0;
  const zillowCount = competing_listings.filter((l) => l.source === 'zillow').length;
  const rentCastCount = competing_listings.filter((l) => l.source === 'rentcast').length;

  // ════════════════════════════════════════════
  // PAGE 1: Summary
  // ════════════════════════════════════════════
  let y = drawHeader(doc);

  // Report title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(BLACK);
  doc.text('RENT ANALYSIS REPORT', MARGIN, y + 4);
  y += 12;

  const dateStr = new Date(analysis.generated_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  if (analysis.prepared_for) {
    // "Exclusively prepared for" prominent banner replaces the date line
    y += 4;
    const bannerH = 46;
    doc.setFillColor('#f0f7f0');
    doc.roundedRect(MARGIN, y, CONTENT_W, bannerH, 4, 4, 'F');
    // Left green accent bar
    doc.setFillColor(GREEN);
    doc.roundedRect(MARGIN, y, 4, bannerH, 2, 0, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MID);
    doc.text('EXCLUSIVELY PREPARED FOR', MARGIN + 16, y + 13);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(GREEN);
    doc.text(analysis.prepared_for, MARGIN + 16, y + 28);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MID);
    doc.text(dateStr, MARGIN + 16, y + 40);

    y += bannerH + 6;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MID);
    doc.text(dateStr, MARGIN, y + 6);
    y += 10;
  }
  y += 18;

  // Subject property box (gray background)
  y = drawSectionTitle(doc, y, 'SUBJECT PROPERTY');

  const propBoxH = 70;
  doc.setFillColor(BG_GRAY);
  doc.roundedRect(MARGIN, y, CONTENT_W, propBoxH, 4, 4, 'F');

  const pad = 12;
  let propY = y + pad + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(BLACK);
  doc.text(subject.address, MARGIN + pad, propY);
  propY += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(DARK);
  doc.text(
    `${subject.town}, OR ${subject.zip_code || ''}   •   ${subject.bedrooms} BR / ${subject.bathrooms || '—'} BA   •   ${subject.sqft ? subject.sqft.toLocaleString() + ' sqft' : 'N/A sqft'}   •   ${subject.property_type}`,
    MARGIN + pad,
    propY
  );
  propY += 14;

  if (subject.current_rent) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MID);
    doc.text(`Current Rent: ${fmt(subject.current_rent)}/mo`, MARGIN + pad, propY);
  }

  y += propBoxH + 24;

  // Recommended rent (prominent green box)
  const hasOverride = analysis.recommended_rent_override && analysis.recommended_rent_override > 0;
  const recBoxH = hasOverride ? 90 : 80;
  doc.setFillColor(GREEN);
  doc.roundedRect(MARGIN, y, CONTENT_W, recBoxH, 6, 6, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(WHITE);
  doc.text('RECOMMENDED RENT', MARGIN + 20, y + 22);

  if (hasOverride) {
    // Show override as the primary number
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text(`${fmt(analysis.recommended_rent_override!)}/mo`, MARGIN + 20, y + 52);

    // Subtitle on its own line
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Recommended for current market conditions', MARGIN + 20, y + 66);

    // Calculated range as small reference text
    doc.setFontSize(8);
    doc.setTextColor('#e3efe3'); // opaque light green: jsPDF writes 8-digit (alpha) hex as an invalid PDF operator
    doc.text(
      `Calculated range: ${fmt(analysis.recommended_rent_low)} - ${fmt(analysis.recommended_rent_high)}/mo (target: ${fmt(analysis.recommended_rent_mid)})`,
      MARGIN + 20,
      y + 80
    );
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(32);
    doc.text(
      `${fmt(analysis.recommended_rent_low)} - ${fmt(analysis.recommended_rent_high)}`,
      MARGIN + 20,
      y + 52
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`Target: ${fmt(analysis.recommended_rent_mid)}/mo`, MARGIN + 20, y + 68);
  }

  y += recBoxH + 16;

  // Manager notes — gray box similar to subject property. A long note
  // continues on the next page in its own box instead of running into the
  // footer or pushing later sections off the page.
  if (analysis.manager_notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const noteLines: string[] = doc.splitTextToSize(analysis.manager_notes, CONTENT_W - 24);
    const NOTE_LINE = 13;
    const NOTE_PAD = 32; // label + top and bottom padding
    let next = 0;
    while (next < noteLines.length) {
      // Start a page if fewer than three lines (or the rest of the note) fit here.
      y = checkPageBreak(doc, y, NOTE_PAD + NOTE_LINE * Math.min(3, noteLines.length - next));
      const fits = Math.floor((FOOTER_Y - 20 - y - NOTE_PAD) / NOTE_LINE);
      const count = Math.max(1, Math.min(noteLines.length - next, fits));
      const noteBoxH = Math.max(count * NOTE_LINE + NOTE_PAD, 46);

      doc.setFillColor(BG_GRAY);
      doc.roundedRect(MARGIN, y, CONTENT_W, noteBoxH, 4, 4, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(LABEL);
      doc.text(next === 0 ? 'NOTES FROM HIGH DESERT PROPERTY MANAGEMENT' : 'NOTES (CONTINUED)', MARGIN + 12, y + 13);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(DARK);
      for (let li = 0; li < count; li++) {
        doc.text(noteLines[next + li], MARGIN + 12, y + 26 + li * NOTE_LINE);
      }

      next += count;
      y += noteBoxH + 16;
      if (next < noteLines.length) {
        doc.addPage();
        y = drawHeader(doc);
      }
    }
  }

  // Quick stats summary — kept together on one page.
  const townBaseline = baselines.find(
    (b) => b.area_name === subject.town && b.bedrooms === subject.bedrooms && b.fmr_rent
  );
  const snapshotH = 20 + 38 + (stats.avg_sqft ? 34 : 0) + (townBaseline?.fmr_rent ? 34 : 0) + 10;
  y = checkPageBreak(doc, y, snapshotH);
  // A long note pushed the snapshot past page 1; let Methodology follow it on the same page.
  const snapshotOnContinuationPage = doc.getNumberOfPages() > 1;
  y = drawSectionTitle(doc, y, 'MARKET SNAPSHOT');

  const colW = CONTENT_W / 4;
  const statItems = [
    { label: 'AVG RENT', value: fmt(stats.avg_rent) },
    { label: 'MEDIAN RENT', value: fmt(stats.median_rent) },
    { label: 'RANGE', value: `${fmt(stats.min_rent)} - ${fmt(stats.max_rent)}` },
    { label: 'SAMPLE SIZE', value: String(stats.count) },
  ];

  for (let i = 0; i < statItems.length; i++) {
    const x = MARGIN + i * colW;
    drawLabel(doc, x, y, statItems[i].label);
    drawValue(doc, x, y + 14, statItems[i].value);
  }

  y += 38;

  if (stats.avg_sqft) {
    const extraStats = [
      { label: 'AVG SQFT', value: stats.avg_sqft.toLocaleString() },
      { label: 'AVG $/SQFT', value: stats.avg_rent_per_sqft ? `$${stats.avg_rent_per_sqft.toFixed(2)}` : 'N/A' },
    ];
    for (let i = 0; i < extraStats.length; i++) {
      const x = MARGIN + i * colW;
      drawLabel(doc, x, y, extraStats[i].label);
      drawValue(doc, x, y + 14, extraStats[i].value, 10);
    }
    y += 34;
  }

  // HUD FMR baseline
  if (townBaseline?.fmr_rent) {
    drawLabel(doc, MARGIN, y, `HUD FAIR MARKET RENT (${subject.town}, ${subject.bedrooms}BR)`);
    drawValue(doc, MARGIN, y + 14, `${fmt(Number(townBaseline.fmr_rent))}/mo`, 10);
    y += 34;
  }


  // ════════════════════════════════════════════
  // PAGE 2: Methodology
  // ════════════════════════════════════════════
  if (snapshotOnContinuationPage) {
    y = checkPageBreak(doc, y + 10, 160);
  } else {
    doc.addPage();
    y = drawHeader(doc);
  }

  y = drawSectionTitle(doc, y, 'METHODOLOGY');

  const BULLET_X = MARGIN + 4;
  const TEXT_X = MARGIN + 16;            // indent for wrapped lines
  const WRAP_W = CONTENT_W - (TEXT_X - MARGIN) - 4; // available width for text

  for (const note of methodology_notes) {
    // Pre-calculate height so page break check is accurate
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const wrappedLines: string[] = doc.splitTextToSize(note, WRAP_W);
    const blockH = wrappedLines.length * 12 + 4;
    y = checkPageBreak(doc, y, blockH);

    // Reset font for every bullet to avoid state bleed
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(DARK);

    // Bullet
    doc.text('•', BULLET_X, y);
    // Wrapped text lines
    for (let li = 0; li < wrappedLines.length; li++) {
      doc.text(wrappedLines[li], TEXT_X, y + li * 12);
    }
    y += blockH;
  }

  y += 16;

  // Data sources summary
  y = checkPageBreak(doc, y, 60);
  y = drawSectionTitle(doc, y, 'DATA SOURCES');

  const sources = [
    `AppFolio: ${comparable_comps.filter((c) => c.data_source === 'appfolio').length} comps from portfolio data`,
    `Manual Entry: ${comparable_comps.filter((c) => c.data_source === 'manual').length} manually entered comps`,
    `Rentometer: ${comparable_comps.filter((c) => c.data_source === 'rentometer').length} Rentometer data points`,
    `HUD FMR: ${baselines.length} Fair Market Rent baselines`,
    `Zillow: ${zillowCount ? `${zillowCount} competing listings` : 'Not included in this report'}`,
    ...(rentCastCount ? [`RentCast: ${rentCastCount} rental listings`] : []),
  ];

  for (const src of sources) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(DARK);
    doc.text('•', BULLET_X, y);
    doc.text(src, TEXT_X, y);
    y += 14;
  }


  // ════════════════════════════════════════════
  // PAGE 3: Comparable Properties Table
  // ════════════════════════════════════════════
  doc.addPage();
  y = drawHeader(doc);

  y = drawSectionTitle(doc, y, `COMPARABLE PROPERTIES (${comparable_comps.length})`);

  // Table header
  const cols = [
    { label: 'ADDRESS', x: MARGIN, w: 160 },
    { label: 'TOWN', x: MARGIN + 165, w: 60 },
    { label: 'BR/BA', x: MARGIN + 230, w: 40 },
    { label: 'SQFT', x: MARGIN + 275, w: 45 },
    { label: 'RENT', x: MARGIN + 325, w: 55 },
    { label: '$/SQFT', x: MARGIN + 385, w: 45 },
    { label: 'DATE', x: MARGIN + 435, w: 55 },
  ];

  doc.setFillColor(GREEN);
  doc.rect(MARGIN, y - 3, CONTENT_W, 14, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(WHITE);
  for (const col of cols) {
    doc.text(col.label, col.x + 3, y + 7);
  }
  y += 16;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  for (let i = 0; i < comparable_comps.length; i++) {
    y = checkPageBreak(doc, y, 16);

    if (y < MARGIN + 20) {
      // We just started a new page, redraw table header
      y = drawSectionTitle(doc, y, `COMPARABLE PROPERTIES (continued)`);
      doc.setFillColor(GREEN);
      doc.rect(MARGIN, y - 3, CONTENT_W, 14, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(WHITE);
      for (const col of cols) {
        doc.text(col.label, col.x + 3, y + 7);
      }
      y += 16;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }

    const comp = comparable_comps[i];

    // Alternate row background
    if (i % 2 === 0) {
      doc.setFillColor(BG_GRAY);
      doc.rect(MARGIN, y - 8, CONTENT_W, 14, 'F');
    }

    doc.setTextColor(DARK);
    const addr = (comp.address || 'N/A').substring(0, 30);
    doc.text(addr, cols[0].x + 3, y);
    doc.text(comp.town, cols[1].x + 3, y);
    doc.text(`${comp.bedrooms}/${comp.bathrooms || '—'}`, cols[2].x + 3, y);
    doc.text(comp.sqft ? comp.sqft.toLocaleString() : '—', cols[3].x + 3, y);
    doc.setTextColor(BLACK);
    doc.setFont('helvetica', 'bold');
    doc.text(fmt(Number(comp.monthly_rent)), cols[4].x + 3, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(DARK);
    doc.text(
      comp.rent_per_sqft ? `$${Number(comp.rent_per_sqft).toFixed(2)}` : '—',
      cols[5].x + 3,
      y
    );
    doc.text(fmtDate(comp.comp_date), cols[6].x + 3, y);

    y += 14;
  }


  // ════════════════════════════════════════════
  // PAGE 4: Competing Listings (if Zillow data)
  // ════════════════════════════════════════════
  if (hasZillow) {
    doc.addPage();
    y = drawHeader(doc);

    y = drawSectionTitle(doc, y, `COMPETING LISTINGS — ${listingSourceLabel(competing_listings).toUpperCase()} (${competing_listings.length})`);

    const zCols = [
      { label: 'ADDRESS', x: MARGIN, w: 200 },
      { label: 'PRICE', x: MARGIN + 205, w: 60 },
      { label: 'BR/BA', x: MARGIN + 270, w: 50 },
      { label: 'SQFT', x: MARGIN + 325, w: 55 },
      { label: 'DAYS', x: MARGIN + 385, w: 40 },
    ];

    doc.setFillColor(GREEN);
    doc.rect(MARGIN, y - 3, CONTENT_W, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(WHITE);
    for (const col of zCols) {
      doc.text(col.label, col.x + 3, y + 7);
    }
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    for (let i = 0; i < competing_listings.length; i++) {
      y = checkPageBreak(doc, y, 16);
      const listing = competing_listings[i];

      if (i % 2 === 0) {
        doc.setFillColor(BG_GRAY);
        doc.rect(MARGIN, y - 8, CONTENT_W, 14, 'F');
      }

      doc.setTextColor(DARK);
      doc.text(listing.address.substring(0, 40), zCols[0].x + 3, y);
      doc.setTextColor(BLACK);
      doc.setFont('helvetica', 'bold');
      doc.text(fmt(listing.price), zCols[1].x + 3, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(DARK);
      doc.text(
        `${listing.bedrooms}/${listing.bathrooms || '—'}`,
        zCols[2].x + 3,
        y
      );
      doc.text(listing.sqft ? listing.sqft.toLocaleString() : '—', zCols[3].x + 3, y);
      doc.text(
        listing.days_on_market !== undefined ? String(listing.days_on_market) : '—',
        zCols[4].x + 3,
        y
      );

      y += 14;
    }

  }

  // Footers last, so every page (including overflow pages) gets one with the real page count.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    drawFooter(doc, page, pageCount);
  }

  // Output buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
