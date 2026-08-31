/**
 * Deposit-to-Hold form merge — replays the click-path mapped during the
 * discovery run:
 *   Communication → Forms → Resident Forms → "Send New Resident Form"
 *   (/forms/documents/new) → Select Unit (search by resident) → Choose
 *   Templates "Deposit to Hold" → Prepare Form → [merged preview].
 *
 * mode 'prepare' STOPS at the merged preview and returns a screenshot — nothing
 * is sent. mode 'send' (past the preview: place signature fields + send-for-
 * signing) is intentionally NOT implemented yet: it is the outward-facing step,
 * gated behind the ToS decision, and must be mapped + enabled deliberately.
 *
 * The wizard was mapped visually, not at the DOM level, so each step tries
 * several candidate selectors and — if none match — returns a compact DOM
 * inventory in the error (fields + buttons on the page) so selectors can be
 * tuned from a real failure instead of a guess. All waits are short so a miss
 * fails fast (no 30s hangs that blow the caller's timeout).
 */

import type { Locator, Page } from 'playwright';
import { APPFOLIO_BASE_URL } from '../appfolio-auth.js';

export interface MergeResult {
  status: 'prepared' | 'error';
  previewImageBase64?: string;
  steps: string[];
  error?: string;
}

const TEMPLATE_LABEL = 'Deposit to Hold';
const FIND_TIMEOUT = 8_000;

/** Compact inventory of a page's interactive elements — for tuning selectors. */
async function describePage(page: Page): Promise<string> {
  const info = await page
    .evaluate(() => {
      const fields = Array.from(document.querySelectorAll('input, textarea, select'))
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type'),
          placeholder: el.getAttribute('placeholder'),
          name: el.getAttribute('name'),
          id: el.id || null,
          aria: el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
        }));
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a.btn'))
        .slice(0, 40)
        .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      return { url: location.href, fields, buttons };
    })
    .catch(() => ({ url: 'unknown', fields: [], buttons: [] }));
  return JSON.stringify(info);
}

/** First candidate locator that exists on the page, else null. */
async function firstPresent(cands: Locator[]): Promise<Locator | null> {
  for (const c of cands) {
    if ((await c.count().catch(() => 0)) > 0) return c.first();
  }
  return null;
}

export async function runDepositToHold(
  page: Page,
  input: { tenantQuery: string; mode: 'prepare' | 'send' }
): Promise<MergeResult> {
  const steps: string[] = [];
  const fail = (where: string, extra: string): MergeResult => ({
    status: 'error',
    steps,
    error: `${where} — ${extra}`,
  });

  if (input.mode === 'send') {
    return fail('send mode is not enabled', 'this worker stops at the merged preview by design');
  }

  await page.goto(`${APPFOLIO_BASE_URL}/forms/documents/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  steps.push('opened Send-New-Resident-Form wizard');

  // ── Select Unit — search by unit/resident ──
  const unit = await firstPresent([
    page.getByPlaceholder(/search by unit or resident/i),
    page.getByPlaceholder(/unit or resident/i),
    page.getByPlaceholder(/search.*(unit|resident|tenant)/i),
    page.getByRole('combobox'),
    page.locator('input[type="search"]'),
    page.locator('input[role="combobox"]'),
    page.getByLabel(/unit|resident|tenant/i),
  ]);
  if (!unit) {
    return fail('unit search field not found', `DOM=${await describePage(page)}`);
  }
  await unit.click();
  await unit.fill(input.tenantQuery);
  steps.push(`typed unit/resident: ${input.tenantQuery}`);

  // Pick the matching option from the dropdown.
  const option = page.getByRole('option', { name: new RegExp(input.tenantQuery.split(/\s+/)[0], 'i') });
  try {
    await option.first().waitFor({ state: 'visible', timeout: FIND_TIMEOUT });
    await option.first().click();
  } catch {
    return fail('no matching unit/resident option', `for "${input.tenantQuery}". DOM=${await describePage(page)}`);
  }
  steps.push('selected unit/resident');

  // ── Choose Templates — "Deposit to Hold" ──
  const templates = await firstPresent([
    page.getByLabel(/choose templates?/i),
    page.getByPlaceholder(/template/i),
    page.getByRole('combobox', { name: /template/i }),
  ]);
  if (templates) {
    await templates.click();
  }
  const tplOption = page.getByRole('option', { name: new RegExp(TEMPLATE_LABEL, 'i') });
  const tplText = page.getByText(new RegExp(TEMPLATE_LABEL, 'i'));
  try {
    const opt = (await tplOption.count()) ? tplOption : tplText;
    await opt.first().waitFor({ state: 'visible', timeout: FIND_TIMEOUT });
    await opt.first().click();
  } catch {
    return fail('template "Deposit to Hold" not found', `DOM=${await describePage(page)}`);
  }
  steps.push(`chose template: ${TEMPLATE_LABEL}`);

  // ── Prepare Form — the merge step ──
  const prepare = await firstPresent([
    page.getByRole('button', { name: /prepare form/i }),
    page.getByRole('button', { name: /prepare/i }),
  ]);
  if (!prepare) {
    return fail('Prepare Form button not found', `DOM=${await describePage(page)}`);
  }
  await prepare.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  steps.push('clicked Prepare Form — merged preview generated');

  // Capture the merged preview (stop here — nothing sent).
  const shot = await page.screenshot({ fullPage: true });
  return { status: 'prepared', previewImageBase64: shot.toString('base64'), steps };
}
