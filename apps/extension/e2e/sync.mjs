// Two Chrome profiles, each with the extension, syncing one vault through a
// real server.
//
//   pnpm --filter @passvaultify/extension build:e2e
//   java -jar apps/server/target/passvaultify-server.jar &        # http://localhost:8080
//   SYNC_SERVER_URL=http://localhost:8080 node apps/extension/e2e/sync.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startSite } from './site.mjs';

const EXT = fileURLToPath(new URL('../dist', import.meta.url));
const SERVER = process.env.SYNC_SERVER_URL ?? 'http://localhost:8080';
const PORT = 4175;
const SITE = `http://localhost:${PORT}`;
const PASSWORD = 'river-lantern-copper-violet-ozone';
const email = `ext-${Date.now()}@example.com`;
const [shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const browser = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : { channel: 'chromium' };

/** A separate Chrome profile with the extension loaded. */
async function profile() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pv-sync-')), {
    ...browser,
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  const setup = await context.newPage();
  await setup.setViewportSize({ width: 1200, height: 900 });
  await setup.goto(`${base}/setup.html`);
  const site = await context.newPage();
  await site.goto(`${SITE}/login`);

  /** The popup, pointed at the site's tab (the e2e build accepts ?tab=). */
  const popup = async () => {
    const tabId = await setup.evaluate(
      async (prefix) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(prefix))?.id,
      SITE,
    );
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(`${base}/popup.html?tab=${tabId}`);
    await page.locator('.pop').first().waitFor();
    return page;
  };
  return { context, setup, popup };
}

async function addLogin(popup, username) {
  await popup.getByRole('button', { name: /Add/ }).first().click();
  await popup.getByLabel('Username or email').fill(username);
  await popup.getByLabel('Password', { exact: true }).fill(`pw-${username}`);
  await popup.getByRole('button', { name: 'Save' }).click();
  await popup.locator('.row__sub', { hasText: username }).waitFor();
}

const server = await startSite(PORT);
const profiles = [];
try {
  // Profile 1 starts a vault, then connects it with a new account.
  const one = await profile();
  profiles.push(one);
  await one.setup.getByLabel('Master password', { exact: true }).fill(PASSWORD);
  await one.setup.getByLabel('Type it again').fill(PASSWORD);
  await one.setup.getByRole('switch').first().click();
  await one.setup.getByRole('button', { name: 'Create vault' }).click();
  await one.setup.getByRole('button', { name: 'Connect…' }).click();
  await one.setup.getByLabel('Server address').fill(SERVER);
  await one.setup.getByRole('button', { name: 'Check server' }).click();
  await one.setup.locator('.server-id').waitFor();
  if (shots) await one.setup.screenshot({ path: `${shots}/ext-sync-connect.png` });
  await one.setup.getByLabel('Email').fill(email);
  await one.setup.getByLabel('Master password').last().fill(PASSWORD);
  await one.setup.getByRole('button', { name: 'Create account and sync' }).click();
  await one.setup.getByText(/Synced through/).waitFor({ timeout: 20000 });
  await one.setup.getByText(/Up to date/).waitFor({ timeout: 20000 });
  check('profile 1 connects and syncs', true);
  if (shots) await one.setup.screenshot({ path: `${shots}/ext-sync-settings.png` });

  let popup = await one.popup();
  await addLogin(popup, 'first@example.com');
  await popup.close();

  // Settings → Add a device: a setup link and its QR code.
  await one.setup.getByRole('button', { name: 'Show link' }).click();
  await one.setup.locator('.pv-qr').waitFor();
  const link = await one.setup.locator('.add-device__link').innerText();
  check('profile 1 shows a setup link with a QR code', link.includes('#connect='), link);
  if (shots) await one.setup.screenshot({ path: `${shots}/ext-sync-add-device.png` });

  // Profile 2 pastes the link on the welcome screen: the fingerprint is checked for it.
  const two = await profile();
  profiles.push(two);
  await two.setup.getByLabel('Server address').fill(link);
  await two.setup.getByRole('button', { name: 'Check server' }).click();
  await two.setup.locator('.server-id__verified').waitFor();
  check('a pasted setup link checks the fingerprint', true);
  await two.setup.getByLabel('Email').fill(email);
  await two.setup.getByLabel('Master password').first().fill(PASSWORD);
  await two.setup.getByRole('button', { name: 'Sign in and sync' }).click();
  await two.setup.getByText(/Synced through/).waitFor({ timeout: 20000 });
  check('profile 2 signs in with the link', true);

  popup = await two.popup();
  await popup.locator('.row__sub', { hasText: 'first@example.com' }).waitFor({ timeout: 20000 });
  check('profile 2 sees the login saved in profile 1', true);
  await addLogin(popup, 'second@example.com');
  await popup.close();

  // Opening the popup in profile 1 pulls profile 2's change.
  await one.setup.waitForTimeout(1500);
  popup = await one.popup();
  await popup.locator('.row__sub', { hasText: 'second@example.com' }).waitFor({ timeout: 20000 });
  check("profile 1's popup shows profile 2's new login", true);
  if (shots) await popup.screenshot({ path: `${shots}/ext-sync-popup.png` });
} catch (error) {
  failures++;
  console.error('ERROR', error);
} finally {
  for (const p of profiles) await p.context.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
