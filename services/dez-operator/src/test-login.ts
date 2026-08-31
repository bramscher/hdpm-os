/**
 * Login smoke test for the Dez operator seat.
 *
 * Validates the critical unknown: can the worker log into AppFolio as dez@ with
 * the stored passkey ALONE, no human, no SMS? Runs the real `withPage` login
 * path and, on success, reports the dashboard title.
 *
 * Run headed (default here) to watch it:  HEADLESS=false npm run test-login
 * Requires APPFOLIO_DEZ_USER / _PASSWORD / _PASSKEY in the environment.
 */

import { withPage, APPFOLIO_BASE_URL, shutdown } from './appfolio-auth.js';

async function main(): Promise<void> {
  console.log('→ attempting dez@ login via passkey…');
  const info = await withPage(async (page) => {
    await page.goto(`${APPFOLIO_BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    return { url: page.url(), title: await page.title() };
  });
  console.log('\n✓ LOGGED IN — passkey login works headless.');
  console.log(`  landed on: ${info.url}`);
  console.log(`  page title: ${info.title}`);
  await shutdown();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('\n✗ login failed:', err instanceof Error ? err.message : err);
  console.error('  (If it stalled on an SMS prompt, passkey-alone login is not enough —');
  console.error('   tell Claude what the browser showed so we can adjust.)');
  await shutdown().catch(() => {});
  process.exit(1);
});
