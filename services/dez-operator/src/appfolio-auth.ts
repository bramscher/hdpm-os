/**
 * AppFolio session management for the Dez operator seat.
 *
 * Logs in as dez@ headless. AppFolio offers no authenticator-app (TOTP) 2FA —
 * only SMS or *passkeys* — so the second factor is a passkey the worker owns: a
 * Chromium virtual authenticator carrying the stored credential
 * (`APPFOLIO_DEZ_PASSKEY`) satisfies the WebAuthn challenge with no human and no
 * phone. See `passkey.ts` and register once with `src/register-passkey.ts`.
 *
 * The logged-in session is persisted (storageState) and reused; we only re-login
 * (and re-present the passkey) when it has expired.
 *
 * NOTE: the login-page selectors below are a first pass — AppFolio's login DOM
 * was not mapped during discovery (we drove an already-authenticated session).
 * Tune them against the real login page on the first live run; the merge FLOW
 * itself (flows/deposit-to-hold.ts) was mapped and is accurate.
 */

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { attachVirtualAuthenticator, loadPasskey } from './passkey.js';

const BASE_URL = process.env.APPFOLIO_BASE_URL ?? 'https://highdesertpm.appfolio.com';
const STORAGE_PATH = process.env.APPFOLIO_STORAGE_STATE ?? './data/storageState.json';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (context) return context;
  // Headless by default (Railway); set HEADLESS=false locally to watch/tune login.
  browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false', args: ['--no-sandbox'] });
  context = await browser.newContext(
    existsSync(STORAGE_PATH) ? { storageState: STORAGE_PATH } : {}
  );
  return context;
}

// AppFolio auth is Keycloak (account.appfolio.com/realms/property). Any of these
// in the URL means we're on the login/SSO leg, not in the app yet.
function onLoginPage(url: string): boolean {
  return /account\.appfolio\.com|\/users\/sign_in|\/login/.test(url);
}

/** We're in the app when the URL is on the tenant host and not a login leg. */
function inApp(url: string): boolean {
  return url.startsWith(BASE_URL) && !onLoginPage(url);
}

/** Heuristic: are we authenticated? Follows the SSO redirect chain, then checks. */
async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
  // Let the Keycloak SSO redirect chain settle (it may bounce through
  // account.appfolio.com and back before landing).
  await page.waitForLoadState('networkidle').catch(() => {});
  return inApp(page.url());
}

/** Fill and submit the login form. Stops if the login finishes by itself partway. */
async function submitLoginForm(page: Page, emailField: Locator, user: string, password: string): Promise<void> {
  await emailField.fill(user);

  // Keycloak may show password on the same page or after a Continue click.
  const passSel =
    'input[type="password"], input[name="password"], input[name="user[password]"], #user_password, #password';
  const passField = page.locator(passSel).first();
  if (inApp(page.url())) return;
  if (!(await passField.isVisible().catch(() => false))) {
    await page
      .getByRole('button', { name: /continue|next|sign in|log in/i })
      .first()
      .click()
      .catch(() => {});
    await passField.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  }
  if (inApp(page.url())) return;
  if (await passField.isVisible().catch(() => false)) {
    await passField.fill(password);
  }
  if (inApp(page.url())) return;
  await page
    .getByRole('button', { name: /sign in|log in|continue|submit/i })
    .first()
    .click()
    .catch(() => {});

  // A passkey step (if any) is auto-satisfied by the virtual authenticator.
  if (inApp(page.url())) return;
  const passkeyBtn = page.getByRole('button', { name: /passkey/i });
  if (await passkeyBtn.count().catch(() => 0)) {
    await passkeyBtn.first().click().catch(() => {});
  }
}

async function performLogin(page: Page): Promise<void> {
  const user = process.env.APPFOLIO_DEZ_USER;
  const password = process.env.APPFOLIO_DEZ_PASSWORD;
  if (!user || !password) {
    throw new Error('APPFOLIO_DEZ_USER / _PASSWORD must be set');
  }

  // Attach the virtual authenticator carrying dez@'s passkey BEFORE navigating,
  // so any WebAuthn ceremony the login triggers is satisfied automatically. Keep
  // the CDP session alive until the login completes, then detach it.
  const { cdp } = await attachVirtualAuthenticator(page, loadPasskey());

  try {
    await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'domcontentloaded' });

    // Two possibilities: (a) Keycloak shows a login FORM, or (b) an existing SSO
    // session auto-redirects us straight into the app (no form). Race them.
    const emailSel =
      'input[type="email"], input[name="username"], input[name="user[email]"], #user_email, #username';
    const emailField = page.locator(emailSel).first();

    const outcome = await Promise.race([
      emailField
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => 'form' as const)
        .catch(() => null),
      page
        .waitForURL((u) => inApp(u.href), { timeout: 20_000 })
        .then(() => 'app' as const)
        .catch(() => null),
    ]);

    // Either way, we're done once we land in the app. That can happen while the
    // form is being filled: the email box offers passkeys on load (autocomplete
    // "username webauthn") and the virtual authenticator approves at once.
    const landed = page.waitForURL((u) => inApp(u.href), { timeout: 60_000 });
    landed.catch(() => {}); // awaited below; don't let it reject unhandled first

    if (outcome === 'form') {
      const form = submitLoginForm(page, emailField, user, password);
      form.catch(() => {}); // loses the race once we've landed, then fails on the gone form
      await Promise.race([form, landed]);
    }

    await landed;

    // Persist the session for reuse.
    mkdirSync(dirname(STORAGE_PATH), { recursive: true });
    writeFileSync(STORAGE_PATH, JSON.stringify(await page.context().storageState()));
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Run `fn` with a logged-in AppFolio page; logs in (with the passkey) if needed. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    if (!(await isLoggedIn(page))) {
      await performLogin(page);
      if (!(await isLoggedIn(page))) {
        throw new Error('AppFolio login failed (check creds / passkey / selectors)');
      }
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
