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

/** Escape a user string for safe use inside a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

/** Detailed report on elements whose own text contains `needle` — tag, class,
 * role, visibility, and char codes (to spot non-breaking spaces etc.). */
async function describeMatch(page: Page, needle: string): Promise<string> {
  return page
    .evaluate((n) => {
      const out: unknown[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const t = el.textContent || '';
        if (t.toLowerCase().includes(n.toLowerCase()) && el.children.length <= 3) {
          const h = el as HTMLElement;
          const s = getComputedStyle(h);
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute('class') || '').slice(0, 50),
            role: el.getAttribute('role'),
            href: el.getAttribute('href'),
            visible: s.display !== 'none' && s.visibility !== 'hidden' && h.offsetParent !== null,
            codes: Array.from(t.slice(0, 24)).map((c) => c.charCodeAt(0)),
            text: t.slice(0, 60),
          });
          if (out.length >= 5) break;
        }
      }
      return JSON.stringify(out);
    }, needle)
    .catch(() => '[]');
}

/** First candidate locator that exists on the page, else null. */
async function firstPresent(cands: Locator[]): Promise<Locator | null> {
  for (const c of cands) {
    if ((await c.count().catch(() => 0)) > 0) return c.first();
  }
  return null;
}

/**
 * Click the first visible clickable element whose text matches `re`, regardless
 * of element type — the wizard renders results/templates as <a>/<button>/<div>,
 * so ARIA-role matching (getByRole('button')) misses the anchor-styled ones.
 */
async function clickByText(page: Page, re: RegExp, timeout = FIND_TIMEOUT): Promise<boolean> {
  // Click the first VISIBLE element carrying the text — a true interactive
  // element (button/a/role) or, failing that, the text node itself (click
  // bubbles to its clickable ancestor). Retry until timeout, since the list may
  // render/settle after the unit is chosen.
  const deadline = Date.now() + timeout;
  const selectors = ['button, a, [role="button"], [role="option"]'];
  while (Date.now() < deadline) {
    const candidates = [
      ...selectors.map((s) => page.locator(s).filter({ hasText: re })),
      page.getByText(re),
    ];
    for (const loc of candidates) {
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        if (!(await el.isVisible().catch(() => false))) continue;
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await el.click({ timeout: 2500 });
          return true;
        } catch {
          /* try the next match */
        }
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

export async function runDepositToHold(
  page: Page,
  input: { tenantQuery: string; mode: 'prepare' | 'send' }
): Promise<MergeResult> {
  const steps: string[] = [];
  const fail = async (where: string, extra: string): Promise<MergeResult> => {
    let shot: string | undefined;
    try {
      shot = (await page.screenshot({ fullPage: true })).toString('base64');
    } catch {
      /* best-effort */
    }
    return { status: 'error', steps, error: `${where} — ${extra}`, previewImageBase64: shot };
  };

  if (input.mode === 'send') {
    return await fail('send mode is not enabled', 'this worker stops at the merged preview by design');
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
    return await fail('unit search field not found', `DOM=${await describePage(page)}`);
  }
  await unit.click();
  await unit.fill(input.tenantQuery);
  await page.waitForTimeout(1500); // let the async result list render
  steps.push(`typed unit/resident: ${input.tenantQuery}`);

  // Select the unit. Canonical combobox selection (ArrowDown → Enter) is robust
  // to dropdown visibility + whitespace quirks; also try clicking the result by
  // first name as a fallback.
  const firstName = input.tenantQuery.split(/\s+/)[0];
  await unit.press('ArrowDown').catch(() => {});
  await unit.press('Enter').catch(() => {});
  await page.waitForTimeout(600);
  await clickByText(page, new RegExp(reEscape(firstName), 'i'), 2500).catch(() => false);
  steps.push('selected unit/resident');

  // ── Choose Templates — "Deposit to Hold" is a clickable item in the list ──
  // AppFolio renders text with irregular (often double) spaces, so match each
  // word with flexible whitespace between.
  const tplRe = new RegExp(TEMPLATE_LABEL.split(/\s+/).map(reEscape).join('\\s+'), 'i');
  if (!(await clickByText(page, tplRe))) {
    return await fail(
      'template "Deposit to Hold" not selectable',
      `tplMatch=${await describeMatch(page, 'Deposit')} DOM=${await describePage(page)}`
    );
  }
  steps.push(`chose template: ${TEMPLATE_LABEL}`);

  // ── Prepare Form — the merge step ──
  if (!(await clickByText(page, /prepare\s+form/i))) {
    return await fail('Prepare Form button not found', `DOM=${await describePage(page)}`);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  steps.push('clicked Prepare Form — merged preview generated');

  // Capture the merged preview (stop here — nothing sent).
  const shot = await page.screenshot({ fullPage: true });
  return { status: 'prepared', previewImageBase64: shot.toString('base64'), steps };
}
