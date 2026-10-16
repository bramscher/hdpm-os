/**
 * Maintenance day sheet (jsPDF): one tech's published route on paper, for the truck.
 * Stops in order with arrival times, the task, door notes, and boxes to tick and write on.
 * Layout follows lib/turn-estimator/estimate-pdf.ts.
 */
import { jsPDF } from 'jspdf';
import { HDPM_LOGO_BASE64 } from '@/lib/hdpm-logo';
import { clockTime, doorNotes, duration, notablePriority, placeLine, routeDayLabel, startClock, type DayRoute } from './route-day';

const BLACK = '#111111';
const DARK = '#333333';
const MID = '#5b625b';
const RED = '#8f2c1f';
const GREEN = '#2f7d32';
const HAIR = '#c7cec7';
const MARGIN = 40;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_ZONE = 40;

export function generateDaySheetPdf(route: DayRoute, printedAt = new Date()): Buffer {
  // compress: the logo is stored raw without it (about 4 MB a page).
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
  let y = MARGIN;
  let page = 1;
  const footer = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MID);
    doc.text(`Printed ${printedAt.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · Planned by the office in HDPM-OS`, MARGIN, PAGE_H - 22);
    doc.text(`Page ${page}`, MARGIN + CONTENT_W, PAGE_H - 22, { align: 'right' });
  };
  const pageBreak = (needed: number) => {
    if (y + needed > PAGE_H - FOOTER_ZONE - 10) {
      footer();
      doc.addPage();
      page++;
      y = MARGIN;
    }
  };

  // Header
  doc.addImage(HDPM_LOGO_BASE64, 'PNG', MARGIN, y - 6, 54, 35);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(BLACK);
  doc.text(`${route.tech} · ${routeDayLabel(route.routeDate)}`, MARGIN + 66, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(DARK);
  const onSite = route.stops.reduce((n, s) => n + s.service_minutes, 0);
  doc.text(`Start ${startClock(route.routeDate, route.startTime)} at the shop · ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'} · about ${duration(onSite)} on site · done about ${clockTime(route.finish)}`, MARGIN + 66, y + 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(GREEN);
  doc.text(route.updated ? 'DAY SHEET (UPDATED)' : 'DAY SHEET', MARGIN + CONTENT_W, y + 2, { align: 'right' });
  y += 44;
  doc.setDrawColor(GREEN);
  doc.setLineWidth(2);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
  y += 16;
  if (route.notes?.trim()) {
    const lines = doc.splitTextToSize(route.notes.trim(), CONTENT_W - 20) as string[];
    doc.setFillColor('#eef5ee');
    doc.roundedRect(MARGIN, y, CONTENT_W, lines.length * 13 + 14, 4, 4, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(BLACK);
    doc.text(lines, MARGIN + 10, y + 16);
    y += lines.length * 13 + 26;
  }

  const textX = MARGIN + 70, textW = CONTENT_W - 70;
  for (const s of route.stops) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const notes = doorNotes(s.details).flatMap(n => doc.splitTextToSize(n, textW) as string[]);
    const task = doc.splitTextToSize([s.wo_number ? `WO ${s.wo_number}` : '', s.details?.task || ''].filter(Boolean).join(' · '), textW) as string[];
    const priority = notablePriority(s.details?.priority);
    const height = 18 + 14 + task.length * 13 + (priority ? 13 : 0) + notes.length * 12 + 12 + 30 + 18;
    pageBreak(height);

    // Number and time
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(GREEN);
    doc.text(String(s.stop_order), MARGIN + 4, y + 14);
    doc.setFontSize(11);
    doc.setTextColor(BLACK);
    doc.text(clockTime(s.arrival), MARGIN + 4, y + 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(MID);
    doc.text(`${duration(s.service_minutes)} on site`, MARGIN + 4, y + 44);

    // Where and what
    let ty = y + 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(BLACK);
    doc.text(placeLine(s), textX, ty);
    ty += 15;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(DARK);
    doc.text(s.address, textX, ty);
    ty += 14;
    doc.setTextColor(BLACK);
    doc.text(task, textX, ty);
    ty += task.length * 13;
    if (priority) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(RED);
      doc.text(`Priority: ${priority}`, textX, ty);
      ty += 13;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(MID);
    if (notes.length) { doc.text(notes, textX, ty); ty += notes.length * 12; }

    // Boxes to tick, and room to write
    ty += 6;
    doc.setDrawColor(DARK);
    doc.setLineWidth(0.8);
    doc.setFontSize(10);
    doc.setTextColor(BLACK);
    let bx = textX;
    for (const label of ['Done', 'Needs return', 'Parts needed']) {
      doc.rect(bx, ty - 9, 11, 11);
      doc.text(label, bx + 16, ty);
      bx += 16 + doc.getTextWidth(label) + 22;
    }
    ty += 22;
    doc.setDrawColor(HAIR);
    doc.setLineWidth(0.6);
    doc.setFontSize(9);
    doc.setTextColor(MID);
    doc.text('Notes', textX, ty - 3);
    doc.line(textX + 30, ty, MARGIN + CONTENT_W, ty);
    ty += 18;
    doc.line(textX, ty, MARGIN + CONTENT_W, ty);
    y = Math.max(ty + 14, y + 60);
    doc.setDrawColor(HAIR);
    doc.line(MARGIN, y - 6, MARGIN + CONTENT_W, y - 6);
    y += 8;
  }
  footer();
  return Buffer.from(doc.output('arraybuffer'));
}
