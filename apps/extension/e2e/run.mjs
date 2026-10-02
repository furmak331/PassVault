// End-to-end test of the real extension in Chromium.
//
//   pnpm --filter @passvaultify/extension build:e2e
//   node apps/extension/e2e/run.mjs [path/to/backup.json] [screenshot-dir]
//
// The e2e build grants localhost access in its manifest, so no permission
// prompt needs a click. Checks: restore a backup, add a login, fill it on its
// own site, refuse to fill a look-alike address, lock and unlock, and the
// "save this login?" flow.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startSite } from './site.mjs';

const EXT = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = 4174;
const SITE = `http://localhost:${PORT}`;
const LOOKALIKE = `http://127.0.0.1:${PORT}`;
const [backupPath, shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const server = await startSite(PORT);
// Extensions need full Chromium: branded Chrome ignores --load-extension, and
// Playwright's default headless shell can't run them. Without CHROMIUM_PATH,
// use the Chromium from `playwright-core install chromium`.
const browser = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : { channel: 'chromium' };
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pv-e2e-')), {
  ...browser,
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}`;
  check('extension loaded', !!id, id);

  // First run: restore the web app's backup in the settings page.
  const setup = await context.newPage();
  await setup.setViewportSize({ width: 1200, height: 860 });
  await setup.goto(`${base}/setup.html`);
  await setup.getByText('Set up PassVaultify in Chrome').waitFor();
  if (shots) await setup.screenshot({ path: `${shots}/setup-welcome.png` });
  if (backupPath) {
    await setup.setInputFiles('.panel input[type=file] >> nth=0', backupPath);
    await setup.getByLabel('Master password of this backup').fill('wrong password');
    await setup.getByRole('button', { name: 'Restore vault' }).click();
    await setup.locator('.form-error').waitFor();
    check(
      'restore rejects a wrong password',
      (await setup.locator('.form-error').innerText()).includes("doesn't open"),
    );
    await setup.getByLabel('Master password of this backup').fill('correct horse battery staple');
    await setup.getByRole('button', { name: 'Restore vault' }).click();
  } else {
    await setup
      .getByLabel('Master password', { exact: true })
      .fill('river-lantern-copper-violet-ozone');
    await setup.getByLabel('Type it again').fill('river-lantern-copper-violet-ozone');
    await setup.getByRole('switch').first().click();
    await setup.getByRole('button', { name: 'Create vault' }).click();
  }
  await setup.locator('.vault-card').waitFor({ timeout: 20000 });
  check(
    'vault set up and unlocked',
    (await setup.locator('.vault-card .pv-label').innerText()).toLowerCase() === 'unlocked',
  );
  if (shots) await setup.screenshot({ path: `${shots}/setup-settings.png` });

  // The site to sign in to, and the popup pointed at its tab.
  const site = await context.newPage();
  await site.goto(`${SITE}/login`);
  const popupFor = async (tabUrlPrefix) => {
    const helper = await context.newPage();
    await helper.goto(`${base}/popup.html`);
    const tabId = await helper.evaluate(async (prefix) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((t) => t.url?.startsWith(prefix))?.id;
    }, tabUrlPrefix);
    await helper.close();
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`${base}/popup.html?tab=${tabId}`);
    await popup.locator('.pop').first().waitFor();
    return popup;
  };

  // Add a login for the local site from the popup.
  let popup = await popupFor(SITE);
  await popup.getByRole('button', { name: /Add/ }).first().click();
  await popup.getByLabel('Username or email').fill('sam@example.com');
  await popup.getByLabel('Password', { exact: true }).fill('Tr1cky"pass,word');
  await popup.getByRole('button', { name: 'Save' }).click();
  await popup.locator('.row').first().waitFor();
  check(
    'login added for the site',
    (await popup.locator('.row__title').first().innerText()) === 'localhost',
  );
  if (shots) await popup.screenshot({ path: `${shots}/popup-site.png` });

  // Fill it.
  // A successful fill closes the popup.
  await Promise.all([
    popup.waitForEvent('close'),
    popup.getByRole('button', { name: 'Fill' }).click(),
  ]);
  await site.waitForTimeout(200);
  const filled = await site.evaluate(() => [
    document.getElementById('email').value,
    document.getElementById('password').value,
  ]);
  check(
    'fills username and password on its own site',
    filled[0] === 'sam@example.com' && filled[1] === 'Tr1cky"pass,word',
    filled.join(' | '),
  );

  // A different address (127.0.0.1 instead of localhost) must get nothing.
  await site.goto(`${LOOKALIKE}/login`);
  popup = await popupFor(LOOKALIKE);
  check('no suggestion on a different address', (await popup.locator('.row').count()) === 0);
  await popup.locator('input[type=search]').fill('localhost');
  await popup.locator('.row').first().waitFor();
  check(
    'search finds it, but offers no Fill there',
    (await popup.getByRole('button', { name: 'Fill' }).count()) === 0,
  );
  const lookalikeValues = await site.evaluate(() => document.getElementById('password').value);
  check('look-alike page stays empty', lookalikeValues === '');

  // Lock, then unlock with a wrong and the right password.
  await popup.getByRole('button', { name: 'Lock' }).click();
  await popup.locator('.pop--lock').waitFor();
  if (shots) await popup.screenshot({ path: `${shots}/popup-locked.png` });
  const master = backupPath ? 'correct horse battery staple' : 'river-lantern-copper-violet-ozone';
  await popup.locator('.combo__input').fill('nope');
  await popup.keyboard.press('Enter');
  await popup.locator('.pop__error').waitFor({ timeout: 15000 });
  check('popup rejects a wrong password', true);
  await popup.locator('.combo__input').fill(master);
  await popup.keyboard.press('Enter');
  await popup.locator('.pop__search').waitFor({ timeout: 15000 });
  check('popup unlocks with the master password', true);
  await popup.close();

  // Offer to save: switch it on, sign up on the site, and save from the popup.
  await setup.bringToFront();
  await setup.getByRole('switch', { name: /Off|On/ }).click();
  await setup.waitForTimeout(500);
  const registered = await setup.evaluate(
    async () => (await chrome.scripting.getRegisteredContentScripts()).length,
  );
  check('save prompts register the content script', registered === 1);
  await site.goto(`${SITE}/signup`);
  await site.fill('#user', 'newuser');
  await site.fill('#pw', 'Fresh-Passw0rd!');
  await site.click('button[type=submit]');
  await site.waitForTimeout(500);
  popup = await popupFor(`${SITE}/signup`);
  await popup
    .locator('.save')
    .waitFor({ timeout: 5000 })
    .catch(() => undefined);
  check('popup offers to save the new login', (await popup.locator('.save').count()) === 1);
  if (shots) await popup.screenshot({ path: `${shots}/popup-save.png` });
  await popup.getByRole('button', { name: 'Save', exact: true }).click();
  await popup.waitForTimeout(300);
  check(
    'saved login appears for the site',
    (await popup.locator('.row__sub', { hasText: 'newuser' }).count()) === 1,
  );

  // Generator view.
  await popup.getByRole('button', { name: 'Password generator' }).click();
  await popup.waitForTimeout(500);
  if (shots) await popup.screenshot({ path: `${shots}/popup-generator.png` });
  check('generator shows a password', (await popup.locator('.pv-secret').innerText()).length >= 20);

  // Nothing secret may be readable from a page.
  const leaked = await site.evaluate(
    () => typeof chrome !== 'undefined' && !!chrome.storage?.session,
  );
  check('pages cannot read the session', !leaked);
} catch (error) {
  failures++;
  console.error('ERROR', error);
} finally {
  await context.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
