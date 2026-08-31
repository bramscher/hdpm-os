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
 * Selectors use role/text where possible; TUNE against the live wizard on the
 * first run (the navigation URLs are accurate; the combobox internals were seen
 * visually, not at the DOM level).
 */

import type { Page } from 'playwright';
import { APPFOLIO_BASE_URL } from '../appfolio-auth.js';

export interface MergeResult {
  status: 'prepared' | 'error';
  previewImageBase64?: string;
  steps: string[];
  error?: string;
}

const TEMPLATE_LABEL = 'Deposit to Hold';

export async function runDepositToHold(
  page: Page,
  input: { tenantQuery: string; mode: 'prepare' | 'send' }
): Promise<MergeResult> {
  const steps: string[] = [];

  if (input.mode === 'send') {
    // Hard stop: the send-for-signing step is not mapped or enabled. Preview only.
    return {
      status: 'error',
      steps,
      error: 'send mode is not enabled — this worker stops at the merged preview by design',
    };
  }

  await page.goto(`${APPFOLIO_BASE_URL}/forms/documents/new`, { waitUntil: 'domcontentloaded' });
  steps.push('opened Send-New-Resident-Form wizard');

  // Select Unit — combobox "Search by unit or resident".
  const unit = page.getByPlaceholder(/search by unit or resident/i);
  await unit.click();
  await unit.fill(input.tenantQuery);
  // TUNE: pick the matching option from the dropdown.
  await page.getByRole('option', { name: new RegExp(input.tenantQuery, 'i') }).first().click();
  steps.push(`selected unit/resident: ${input.tenantQuery}`);

  // Choose Templates — pick "Deposit to Hold".
  const templates = page.getByLabel(/choose templates/i);
  await templates.click();
  await page.getByRole('option', { name: new RegExp(TEMPLATE_LABEL, 'i') }).first().click();
  steps.push(`chose template: ${TEMPLATE_LABEL}`);

  // Prepare Form — the merge step.
  await page.getByRole('button', { name: /prepare form/i }).click();
  await page.waitForLoadState('networkidle');
  steps.push('clicked Prepare Form — merged preview generated');

  // Capture the merged preview (stop here — nothing sent).
  const shot = await page.screenshot({ fullPage: true });
  return {
    status: 'prepared',
    previewImageBase64: shot.toString('base64'),
    steps,
  };
}
