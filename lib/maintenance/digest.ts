/**
 * Maintenance OS — per-owner exception digest (pure builder).
 *
 * One email per accountable person per day, listing only THEIR tripwire
 * exceptions, grouped by tripwire number, linking back to the Exceptions view.
 */

import type { TripwireException } from './types';

// Brand greens from the dashboard mockup (docs/maintenance-os/04-dashboard-mockup.html)
const DK = '#1f5c22';
const GR = '#2f7d32';
const TINT = '#eef5ee';
const HAIR = '#c7cec7';
const MUTED = '#5b625b';
const RED = '#b3261e';

export interface Digest {
  subject: string;
  html: string;
  text: string;
}

/** Group exceptions by owner name. */
export function groupByOwner(exceptions: TripwireException[]): Map<string, TripwireException[]> {
  const byOwner = new Map<string, TripwireException[]>();
  for (const ex of exceptions) {
    const list = byOwner.get(ex.owner) ?? [];
    list.push(ex);
    byOwner.set(ex.owner, list);
  }
  return byOwner;
}

/**
 * Build one owner's digest. Returns null when they have no exceptions
 * (no email on a clean day — zero is the goal, not a notification).
 */
export function buildDigest(
  owner: string,
  exceptions: TripwireException[],
  dateStr: string,
  baseUrl: string
): Digest | null {
  if (exceptions.length === 0) return null;

  const sorted = [...exceptions].sort((a, b) => a.tripwire - b.tripwire);
  const boardUrl = `${baseUrl}/maintenance/board?view=exceptions`;

  const subject = `Maintenance exceptions (${exceptions.length}) — fix today, ${dateStr}`;

  const rowsHtml = sorted
    .map(
      (ex) => `
      <tr>
        <td style="padding:7px 10px;border:1px solid ${HAIR};color:${RED};font-weight:700;white-space:nowrap;">${ex.label}</td>
        <td style="padding:7px 10px;border:1px solid ${HAIR};">${escapeHtml(ex.item)}</td>
        <td style="padding:7px 10px;border:1px solid ${HAIR};">${escapeHtml(ex.fixRequired)}</td>
      </tr>`
    )
    .join('');

  const html = `
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:720px;">
  <div style="border-bottom:3px solid ${GR};padding-bottom:10px;margin-bottom:14px;">
    <h1 style="font-size:20px;color:${DK};margin:0;">HDMS Maintenance — Exceptions for ${escapeHtml(owner)}</h1>
    <p style="color:${MUTED};font-size:13px;margin:4px 0 0;">${dateStr} · ${exceptions.length} item(s) · each needs action today</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <tr>
      <th style="background:${TINT};color:${DK};text-align:left;padding:8px 10px;border:1px solid ${HAIR};font-size:12px;">Tripwire</th>
      <th style="background:${TINT};color:${DK};text-align:left;padding:8px 10px;border:1px solid ${HAIR};font-size:12px;">Item</th>
      <th style="background:${TINT};color:${DK};text-align:left;padding:8px 10px;border:1px solid ${HAIR};font-size:12px;">Fix required today</th>
    </tr>
    ${rowsHtml}
  </table>
  <p style="margin-top:16px;">
    <a href="${boardUrl}" style="background:${GR};color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Open the Exceptions view</a>
  </p>
  <p style="font-size:12px;color:${MUTED};border-top:1px solid ${HAIR};padding-top:8px;margin-top:16px;">
    The daily sweep ends when the Exceptions view reads ZERO — every exception gets an HDPM owner and a date, or gets escalated.
  </p>
</div>`;

  const text = [
    `HDMS Maintenance — Exceptions for ${owner} (${dateStr})`,
    '',
    ...sorted.map((ex) => `${ex.label}: ${ex.item} → ${ex.fixRequired}`),
    '',
    `Open the Exceptions view: ${boardUrl}`,
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
