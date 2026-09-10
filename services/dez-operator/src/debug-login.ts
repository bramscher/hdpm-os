/**
 * Login DIAGNOSTIC — captures what Keycloak shows during dez@ login so we can
 * see the "passkey invalid" banner text and whether login needs the passkey at
 * all. Saves two screenshots (mid-login + end) and prints any alert/banner text
 * and console messages. Does not touch storageState.
 *
 *   bash debug-login.sh                 # normal (passkey attached)
 *   SKIP_PASSKEY=true bash debug-login.sh   # password-only, is 2FA enforced?
 */

import { chromium } from 'playwright';
import { attachVirtualAuthenticator, loadPasskey } from './passkey.js';

const BASE_URL = process.env.APPFOLIO_BASE_URL ?? 'https://highdesertpm.appfolio.com';
const SHOT_DIR = process.env.SHOT_DIR ?? './data';

function onLoginPage(u: string): boolean {
  return /account\.appfolio\.com|\/users\/sign_in|\/login/.test(u);
}

async function main(): Promise<void> {
  const user = process.env.APPFOLIO_DEZ_USER;
  const password = process.env.APPFOLIO_DEZ_PASSWORD;
  if (!user || !password) throw new Error('APPFOLIO_DEZ_USER / _PASSWORD required');
  const skipPasskey = process.env.SKIP_PASSKEY === 'true';

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (m) => console.log('  [console]', m.type(), m.text().slice(0, 200)));

  const { cdp } = await attachVirtualAuthenticator(page, skipPasskey ? undefined : loadPasskey());
  console.log(skipPasskey ? '→ passkey NOT attached (password-only test)' : '→ passkey attached');

  await page.goto(`${BASE_URL}/users/sign_in`, { waitUntil: 'domcontentloaded' });

  const email = page
    .locator('input[type="email"], input[name="username"], #username, #user_email')
    .first();
  await email.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => console.log('(no email field — SSO redirect?)'));

  if (await email.isVisible().catch(() => false)) {
    await email.fill(user);
    const pass = page.locator('input[type="password"], #password, #user_password').first();
    if (!(await pass.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /continue|next|sign in|log in/i }).first().click().catch(() => {});
      await pass.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    }
    if (await pass.isVisible().catch(() => false)) await pass.fill(password);
    await page.getByRole('button', { name: /sign in|log in|continue|submit/i }).first().click().catch(() => {});
    console.log('→ submitted credentials');
  }

  // Capture the moment a banner is most likely showing.
  await page.waitForTimeout(2_500);
  const shot1 = `${SHOT_DIR}/debug-login-1.png`;
  await page.screenshot({ path: shot1, fullPage: true }).catch(() => {});
  const alerts1 = await page
    .locator('[role="alert"], .alert, .pf-c-alert, .kc-feedback-text, .error, .message, .feedback')
    .allInnerTexts()
    .catch(() => []);
  console.log(`\n[mid] URL: ${page.url()}`);
  console.log(`[mid] banners/alerts: ${JSON.stringify(alerts1)}`);
  console.log(`[mid] screenshot → ${shot1}`);

  // Let it settle, capture the end state.
  await page.waitForTimeout(5_000);
  const shot2 = `${SHOT_DIR}/debug-login-2.png`;
  await page.screenshot({ path: shot2, fullPage: true }).catch(() => {});
  const reached = page.url().startsWith(BASE_URL) && !onLoginPage(page.url());
  console.log(`\n[end] URL: ${page.url()}`);
  console.log(`[end] reached app (logged in): ${reached}`);
  console.log(`[end] screenshot → ${shot2}`);

  await cdp.detach().catch(() => {});
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
