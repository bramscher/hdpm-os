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
import { buildNearbyRentals, type NearbyRentals } from './rent-report-nearby';

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
// Nearby Rentals (modelled on AppFolio's Nearby Advertised Units)
// ============================================

// Monochrome to match the HDPM OS theme; HDPM green marks only "your rent".
const BAR = '#d6d6d6';
const BAR_MEDIAN = '#363636';
const BAR_YOURS = '#9fc29f';
const YOUR_FILL = '#e6f1e6';
const YOUR_COLUMN = '#eef5ee';
const BAND_LOW = '#f4f4f4';
const BAND_HIGH = '#8a8a8a';
const UP = '#2f7d32';
const DOWN = '#b3261e';

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Small up/down triangle plus a signed amount, e.g. ▲ 50 / ▼ $200 (drawn; standard fonts have no arrows). */
function drawDelta(doc: jsPDF, x: number, y: number, diff: number | null, money: boolean, higherIsGood: boolean): void {
  if (diff == null || diff === 0) return;
  const up = diff > 0;
  doc.setFillColor(up === higherIsGood ? UP : DOWN);
  if (up) doc.triangle(x, y - 1, x + 6, y - 1, x + 3, y - 6, 'F');
  else doc.triangle(x, y - 6, x + 6, y - 6, x + 3, y - 1, 'F');
  doc.setTextColor(up === higherIsGood ? UP : DOWN);
  doc.text(money ? fmt(Math.abs(diff)) : Math.abs(diff).toLocaleString(), x + 9, y);
}

function drawNearbyRentals(doc: jsPDF, startY: number, m: NearbyRentals): number {
  let y = drawSectionTitle(doc, startY, 'NEARBY RENTALS');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(MID);
  doc.text(
    `${m.rows.length} similar rentals advertised near this property, ranked by similarity (RentCast). ${m.above} ask more than your rent and ${m.below} ask less.`,
    MARGIN,
    y
  );
  y += 12;

  // Your unit strip
  const stripH = 40;
  doc.setFillColor(YOUR_FILL);
  doc.roundedRect(MARGIN, y, CONTENT_W, stripH, 4, 4, 'F');
  drawLabel(doc, MARGIN + 12, y + 14, 'YOUR UNIT');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(BLACK);
  doc.text(String(m.unit.address).slice(0, 48), MARGIN + 12, y + 28);
  const cols: [string, string][] = [
    ['BEDS', String(m.unit.bedrooms)],
    ['BATHS', m.unit.bathrooms != null ? String(m.unit.bathrooms) : '—'],
    ['SQ FT', m.unit.sqft ? m.unit.sqft.toLocaleString() : '—'],
    ['YOUR RENT', fmt(m.unit.rent)],
  ];
  cols.forEach(([label, value], i) => {
    const x = MARGIN + 300 + i * 54;
    drawLabel(doc, x, y + 14, label);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(i === 3 ? 11 : 10);
    doc.setTextColor(i === 3 ? GREEN : BLACK);
    doc.text(value, x, y + 28);
  });
  y += stripH + 22;

  // Histogram
  const chartX = MARGIN + 30;
  const chartW = CONTENT_W - 40;
  const chartH = 120;
  const top = y + 10;
  const base = top + chartH;
  const maxCount = Math.max(1, ...m.bins.map((b) => b.count));
  const binW = chartW / m.bins.length;
  const barX = (i: number) => chartX + i * binW;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setDrawColor(LIGHT_BORDER);
  doc.setLineWidth(0.4);
  for (let c = 0; c <= maxCount; c++) {
    const gy = base - (c / maxCount) * chartH;
    if (c > 0) doc.line(chartX, gy, chartX + chartW, gy);
    doc.setTextColor(MID);
    if (c > 0) doc.text(String(c), chartX - 8, gy + 2, { align: 'right' });
  }
  doc.setTextColor(LABEL);
  doc.text('Number of rentals', MARGIN + 4, base - chartH / 2 + 30, { angle: 90 });

  // Your rent column behind the bars
  doc.setFillColor(YOUR_COLUMN);
  doc.rect(barX(m.yourBin) + 1, top - 6, binW - 2, chartH + 6, 'F');

  m.bins.forEach((b, i) => {
    if (!b.count) return;
    const h = (b.count / maxCount) * chartH;
    doc.setFillColor(i === m.medianBin ? BAR_MEDIAN : i === m.yourBin ? BAR_YOURS : BAR);
    doc.rect(barX(i) + 1.5, base - h, binW - 3, h, 'F');
  });

  doc.setDrawColor(GREEN);
  doc.setLineWidth(0.8);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(barX(m.yourBin) + 1, top - 6, binW - 2, chartH + 6, 'S');
  doc.setLineDashPattern([], 0);

  // Median label above its bin
  const medX = barX(m.medianBin) + binW / 2;
  const medLabel = `Median ${fmt(m.median)}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  const medW = doc.getTextWidth(medLabel) + 10;
  const medLeft = Math.min(Math.max(medX - medW / 2, chartX), chartX + chartW - medW);
  doc.setFillColor(WHITE);
  doc.setDrawColor(LIGHT_BORDER);
  doc.setLineWidth(0.5);
  doc.roundedRect(medLeft, top - 22, medW, 13, 2, 2, 'FD');
  doc.setTextColor(BLACK);
  doc.text(medLabel, medLeft + 5, top - 13);

  // Axis band: low (light) to high (dark)
  const bandY = base + 2;
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    doc.setFillColor(mix(BAND_LOW, BAND_HIGH, t));
    doc.rect(chartX + (i * chartW) / steps, bandY, chartW / steps + 0.5, 6, 'F');
  }

  // House marker under your rent
  const hx = barX(m.yourBin) + binW / 2;
  const hy = bandY + 6;
  doc.setFillColor(GREEN);
  doc.triangle(hx - 6, hy + 6, hx + 6, hy + 6, hx, hy, 'F');
  doc.rect(hx - 4, hy + 6, 8, 6, 'F');

  // Tick labels at bin edges (thinned to fit)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(MID);
  const every = Math.ceil(m.bins.length / 8);
  for (let i = 0; i <= m.bins.length; i += every) {
    const v = m.bins[0].from + i * m.binWidth;
    doc.text(fmt(v), chartX + i * binW, bandY + 22, { align: 'center' });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(`Low ${fmt(m.low)}`, chartX, bandY + 34);
  doc.text(`High ${fmt(m.high)}`, chartX + chartW, bandY + 34, { align: 'right' });

  y = bandY + 50;

  // Table
  const tcols = [
    { label: 'SIMILARITY', x: MARGIN },
    { label: 'BEDS', x: MARGIN + 74 },
    { label: 'BATHS', x: MARGIN + 104 },
    { label: 'SQ FT', x: MARGIN + 138 },
    { label: 'LOCATION', x: MARGIN + 216 },
    { label: 'LAST ADVERTISED', x: MARGIN + 316 },
    { label: 'RENT', x: MARGIN + 400 },
  ];
  const drawTableHeader = () => {
    doc.setFillColor(BG_GRAY);
    doc.rect(MARGIN, y - 9, CONTENT_W, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(LABEL);
    for (const c of tcols) doc.text(c.label, c.x + 3, y);
    y += 14;
  };
  drawTableHeader();

  for (let i = 0; i < m.rows.length; i++) {
    const before = doc.getNumberOfPages();
    y = checkPageBreak(doc, y, 18);
    if (doc.getNumberOfPages() > before) {
      y = drawSectionTitle(doc, y, 'NEARBY RENTALS (continued)');
      drawTableHeader();
    }
    const r = m.rows[i];
    if (i % 2 === 1) {
      doc.setFillColor('#fafafa');
      doc.rect(MARGIN, y - 10, CONTENT_W, 16, 'F');
    }
    // Similarity bar
    doc.setFillColor('#dfe7df');
    doc.rect(MARGIN + 3, y - 7, 44, 8, 'F');
    doc.setFillColor(GREEN);
    doc.rect(MARGIN + 3, y - 7, (44 * r.similarity) / 100, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(DARK);
    doc.text(`${r.similarity}%`, MARGIN + 50, y);

    doc.setFont('helvetica', 'normal');
    doc.text(String(r.bedrooms), tcols[1].x + 3, y);
    doc.text(String(r.bathrooms), tcols[2].x + 3, y);
    doc.text(r.sqft ? r.sqft.toLocaleString() : '—', tcols[3].x + 3, y);
    drawDelta(doc, tcols[3].x + 34, y, r.sqftDiff, false, true);
    doc.setTextColor(DARK);
    doc.text(r.distanceLabel, tcols[4].x + 3, y);
    doc.text(fmtDate(r.lastAdvertised), tcols[5].x + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BLACK);
    doc.text(fmt(r.rent), tcols[6].x + 3, y);
    doc.setFont('helvetica', 'normal');
    drawDelta(doc, tcols[6].x + 46, y, r.rentDiff, true, true);
    y += 16;
  }

  y = checkPageBreak(doc, y, 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(LABEL);
  doc.text(
    'Similar rentals from RentCast. Similarity is RentCast\'s match score; rents are advertised asking rents, not signed leases.',
    MARGIN,
    y + 6
  );
  doc.text('The green dashed column and house mark your rent. Arrows compare each rental with your unit: green = more, red = less.', MARGIN, y + 16);
  return y + 26;
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
  // Nearby Rentals (when RentCast returned enough comparables)
  const nearby = buildNearbyRentals(analysis, (analysis.generated_at || new Date().toISOString()).slice(0, 10));
  if (nearby) {
    doc.addPage();
    y = drawNearbyRentals(doc, drawHeader(doc), nearby);
  }

  // PAGE 2: Methodology
  // ════════════════════════════════════════════
  if (nearby || snapshotOnContinuationPage) {
    y = checkPageBreak(doc, y + 10, 160);
  } else {
    doc.addPage();
    y = drawHeader(doc);
  }

  y = drawSectionTitle(doc, y, 'METHODOLOGY');

  const BULLET_X = MARGIN + 4;
  const TEXT_X = MARGIN + 16;            // indent for wrapped lines
  const WRAP_W = CONTENT_W - (TEXT_X - MARGIN) - 4; // available width for text

  const notesToShow = nearby
    ? [...methodology_notes, `Nearby rentals page: ${nearby.rows.length} RentCast comparables, ranked by similarity`]
    : methodology_notes;
  for (const note of notesToShow) {
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

  // Only list sources that actually contributed; a "0" line reads as missing data.
  const compsFrom = (source: string) => comparable_comps.filter((c) => c.data_source === source).length;
  const sourceLines: [number, string][] = [
    [compsFrom('appfolio'), `AppFolio: ${compsFrom('appfolio')} comps from portfolio data`],
    [compsFrom('rentcast'), `RentCast: ${compsFrom('rentcast')} advertised rental comps`],
    [compsFrom('manual'), `Manual Entry: ${compsFrom('manual')} manually entered comps`],
    [compsFrom('rentometer'), `Rentometer: ${compsFrom('rentometer')} Rentometer data points`],
    [rentCastCount, `RentCast: ${rentCastCount} nearby listings near the subject property`],
    [zillowCount, `Zillow: ${zillowCount} competing listings`],
  ];
  const sources = sourceLines.filter(([count]) => count > 0).map(([, line]) => line);
  if (townBaseline?.fmr_rent) {
    sources.push(`HUD FMR: ${subject.town} ${subject.bedrooms}BR Fair Market Rent, ${fmt(Number(townBaseline.fmr_rent))}/mo`);
  }

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
