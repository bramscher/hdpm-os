/**
 * AppFolio session management for the Dez operator seat.
 *
 * Logs in as dez@ headless, generating the 2FA code from the authenticator
 * setup key (TOTP) so no human is in the loop — this is why dez@ MUST enroll
 * MFA via an authenticator app, NOT SMS. The logged-in session is persisted
 * (storageState) and reused; we only re-login when it has expired.
 *
 * NOTE: the login-page selectors below are a first pass — AppFolio's login DOM
 * was not mapped during discovery (we drove an already-authenticated session).
 * Tune them against the real login page on the first live run; the merge FLOW
 * itself (flows/deposit-to-hold.ts) was mapped and is accurate.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { authenticator } from 'otplib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE_URL = process.env.APPFOLIO_BASE_URL ?? 'https://highdesertpm.appfolio.com';
const STORAGE_PATH = process.env.APPFOLIO_STORAGE_STATE ?? './data/storageState.json';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext(
    existsSync(STORAGE_PATH) ? { storageState: STORAGE_PATH } : {}
  );
  return context;
}

/** Heuristic: are we authenticated? (dashboard reachable, no login form). */
async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (/\/users\/sign_in|\/login/.test(page.url())) return false;
  // The left nav "Property Manager" brand only renders inside the app.
  return (await page.locator('text=Property Manager').count()) > 0;
}

async function performLogin(page: Page): Promise<void> {
  const user = process.env.APPFOLIO_DEZ_USER;
  const password = process.env.APPFOLIO_DEZ_PASSWORD;
  const totpSecret = process.env.APPFOLIO_DEZ_TOTP_SECRET;
  if (!user || !password || !totpSecret) {
    throw new Error('APPFOLIO_DEZ_USER / _PASSWORD / _TOTP_SECRET must be set');
  }

  await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'domcontentloaded' });
  // TUNE: email/password field selectors against the real login page.
  await page.fill('input[type="email"], input[name="user[email]"], #user_email', user);
  await page.fill('input[type="password"], input[name="user[password]"], #user_password', password);
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForLoadState('domcontentloaded');

  // MFA step — enter the current TOTP code if prompted.
  const codeField = page.locator(
    'input[name*="otp" i], input[name*="code" i], input[autocomplete="one-time-code"]'
  );
  if (await codeField.count()) {
    const code = authenticator.generate(totpSecret);
    await codeField.first().fill(code);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForLoadState('domcontentloaded');
  }

  // Persist the session for reuse.
  mkdirSync(dirname(STORAGE_PATH), { recursive: true });
  const state = await page.context().storageState();
  writeFileSync(STORAGE_PATH, JSON.stringify(state));
}

/** Run `fn` with a logged-in AppFolio page; logs in (with TOTP) if needed. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    if (!(await isLoggedIn(page))) {
      await performLogin(page);
      if (!(await isLoggedIn(page))) throw new Error('AppFolio login failed (check creds / TOTP / selectors)');
    }
    return await fn(page);
  } finally {
    await page.close();
  }
}

export async function shutdown(): Promise<void> {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  context = null;
  browser = null;
}

export const APPFOLIO_BASE_URL = BASE_URL;
