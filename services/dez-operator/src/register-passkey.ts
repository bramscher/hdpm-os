/**
 * ONE-TIME passkey registration for the Dez AppFolio operator seat (dez@).
 *
 * WHY: AppFolio has no authenticator-app (TOTP) 2FA — only SMS or passkeys — so
 * the headless worker authenticates with a passkey it *owns*. A passkey created
 * through a normal browser prompt is bound to that Mac's keychain and is useless
 * to a cloud worker. This script instead registers the passkey against a Chromium
 * *virtual authenticator* whose private key we keep, then prints
 * `APPFOLIO_DEZ_PASSKEY` for the worker's env.
 *
 * HUMAN-ASSISTED: rather than guess AppFolio's password/login selectors, the
 * script opens a VISIBLE Chrome, you set the password + click through to
 * "Register a passkey" and click it, and the script watches the virtual
 * authenticator and captures the credential the instant it's created (the
 * virtual authenticator answers the WebAuthn prompt regardless of who clicks).
 *
 * HOW TO RUN:
 *   1. AppFolio (admin): "Reset Login" on dez@ → emails a setup link to
 *      dez@highdesertpm.com.
 *   2. SETUP_URL="…link…" NEW_PASSWORD="…" npm run register-passkey
 *      (or just: bash register-passkey.sh)
 *   3. Complete password + passkey in the Chrome window; copy the printed
 *      APPFOLIO_DEZ_PASSKEY into Railway.
 *
 * Set HEADLESS=true only once the flow is proven. REGISTER_TIMEOUT_MS overrides
 * the manual window (default 5 min).
 */

import { chromium } from 'playwright';
import { attachVirtualAuthenticator, exportCredential, encodePasskey } from './passkey.js';

const BASE_URL = process.env.APPFOLIO_BASE_URL ?? 'https://highdesertpm.appfolio.com';
// Where to open. For a fresh account use the reset-login email link (SETUP_URL);
// to add a passkey to an already-set-up account, omit it and we open the login
// page (START_URL overrides either).
const START_URL = process.env.START_URL ?? process.env.SETUP_URL ?? `${BASE_URL}/users/sign_in`;
const NEW_PASSWORD = process.env.NEW_PASSWORD;
const HEADLESS = process.env.HEADLESS === 'true';
const WAIT_MS = Number(process.env.REGISTER_TIMEOUT_MS ?? 900_000); // 15-minute manual window

async function main(): Promise<void> {

  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Attach an EMPTY virtual authenticator — the site creates the credential on it.
  const { cdp, authenticatorId } = await attachVirtualAuthenticator(page);

  try {
    console.log(`→ opening ${START_URL.slice(0, 60)}…`);
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });

    // Best-effort: pre-fill the new password if the field is already present.
    if (NEW_PASSWORD) {
      const pw = page.locator('input[type="password"]');
      try {
        await pw.first().waitFor({ timeout: 5_000 });
      } catch {
        /* no field yet — that's fine, you'll type it below */
      }
      const n = await pw.count();
      if (n > 0) {
        for (let i = 0; i < n; i++) await pw.nth(i).fill(NEW_PASSWORD).catch(() => {});
        console.log(`→ pre-filled ${n} password field(s) — click the page's Save/Continue`);
      }
    }

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('  In the Chrome window that just opened, get dez@ logged in:');
    console.log("    1. Set/enter dez@'s password (may be pre-filled), Save.");
    console.log('    2. Complete any phone/SMS 2-factor step (enter the code).');
    console.log('    3. Once inside AppFolio: go to your name → Login Settings →');
    console.log('       Passkeys → "Add passkey".');
    console.log('    4. When the "Register a passkey" prompt shows, click Register.');
    console.log("  I'm watching — I capture the passkey automatically and print it.");
    console.log(`  (waiting up to ${Math.round(WAIT_MS / 60000)} min)`);
    console.log('──────────────────────────────────────────────────────────\n');

    // Poll the virtual authenticator until a passkey is registered — by you, or
    // by the one opportunistic auto-click below if the button is already visible.
    const deadline = Date.now() + WAIT_MS;
    let clicked = false;
    let found = false;
    while (Date.now() < deadline) {
      if (!clicked) {
        const btn = page.getByRole('button', { name: /register passkey/i });
        if ((await btn.count().catch(() => 0)) > 0) {
          await btn.first().click().catch(() => {});
          clicked = true;
          console.log('→ clicked "Register passkey" for you');
        }
      }
      const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      if (credentials.length > 0) {
        found = true;
        break;
      }
      await page.waitForTimeout(1_500);
    }

    if (!found) {
      throw new Error(
        `no passkey was registered within ${Math.round(WAIT_MS / 1000)}s — re-run and complete the "Register a passkey" step`
      );
    }

    const cred = await exportCredential(cdp, authenticatorId);
    const encoded = encodePasskey(cred);

    console.log('\n===== APPFOLIO_DEZ_PASSKEY (set this in Railway) =====\n');
    console.log(encoded);
    console.log('\n=====================================================\n');
    console.log(`rpId: ${cred.rpId}`);
    console.log(`credentialId: ${cred.credentialId.slice(0, 16)}…`);
    console.log('\nAlso set on the worker: APPFOLIO_DEZ_USER=dez@highdesertpm.com, APPFOLIO_DEZ_PASSWORD=<the password you set>.');
  } finally {
    await cdp.detach().catch(() => {});
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
