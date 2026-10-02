// Two devices syncing through a real server, in Chromium, against the
// production build (so the Content Security Policy is enforced).
//
//   pnpm --filter @passvaultify/web build && pnpm --filter @passvaultify/web exec vite preview --port 4173 &
//   java -jar apps/server/target/passvaultify-server.jar &        # http://localhost:8080
//   SYNC_SERVER_URL=http://localhost:8080 node apps/web/e2e/sync.mjs [screenshot-dir]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:4173/';
const SERVER = process.env.SYNC_SERVER_URL ?? 'http://localhost:8080';
const [shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const email = `sam-${Date.now()}@example.com`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const problems = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`);
  });
  await page.goto(WEB, { waitUntil: 'networkidle' });
  return page;
}

const shot = async (page, file) => shots && (await page.screenshot({ path: `${shots}/${file}` }));
const listHas = (page, title) => page.locator('.list-pane').getByText(title, { exact: true });

async function addLogin(page, title, username) {
  await page.locator('.side__new').click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Username or email').fill(username);
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.getByRole('button', { name: 'Use password' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await listHas(page, title).waitFor();
}

try {
  // Device A: create a vault that will live on "your own server".
  const a = await device('A');
  await a.getByRole('button', { name: 'Create a vault' }).click();
  await a.getByLabel('Your name').fill('Sam');
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.locator('input[value=self]').check();
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.getByRole('button', { name: 'Continue' }).click();
  await a.getByRole('button', { name: 'Suggest a passphrase' }).click();
  const master = await a.getByLabel('Master password', { exact: true }).inputValue();
  await a.getByLabel('Type it again').fill(master);
  await a.locator('.check').click();
  await a.getByRole('button', { name: 'Seal the vault' }).click();
  await a.getByRole('button', { name: 'Open the vault' }).click({ timeout: 30000 });
  await addLogin(a, 'GitHub', 'sam');

  // Connect it: server, fingerprint, then a new account.
  await a.getByRole('button', { name: 'Set up sync' }).click();
  await a.getByLabel('Server address').fill(SERVER);
  await a.getByRole('button', { name: 'Check server' }).click();
  await a.locator('.server-id').waitFor();
  await shot(a, 'sync-1-server.png');
  check(
    'server fingerprint shown before signing in',
    /[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}/.test(
      await a.locator('.server-id .pv-fp-code').innerText(),
    ),
  );
  await a.getByLabel('Email').fill(email);
  await a.getByLabel('Master password').fill(master);
  await a.getByRole('button', { name: 'Create account' }).click();
  await a.locator('.sync-chip', { hasText: 'Synced' }).waitFor({ timeout: 20000 });
  check('device A is connected and synced', true);
  await shot(a, 'sync-2-connected.png');

  // Device B: a fresh browser signs in from the welcome screen.
  const b = await device('B');
  await b.getByRole('button', { name: /Sign in to your server/ }).click();
  await b.getByLabel('Server address').fill(SERVER);
  await b.getByRole('button', { name: 'Check server' }).click();
  await b.getByLabel('Email').fill(email);
  await b.getByLabel('Master password').fill(master);
  await b.getByRole('button', { name: 'Sign in', exact: true }).click();
  await listHas(b, 'GitHub').waitFor({ timeout: 20000 });
  check('device B signs in and gets the vault', true);
  const fingerprintOf = async (page) => {
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const code = await page.locator('.fp-row .pv-fp-code').innerText();
    await page.keyboard.press('Escape');
    return code;
  };
  const [fpA, fpB] = [await fingerprintOf(a), await fingerprintOf(b)];
  check('same vault fingerprint on both devices', fpA === fpB, fpA);

  // A change on B shows up on A without a reload.
  await addLogin(b, 'Router', 'admin');
  await listHas(a, 'Router').waitFor({ timeout: 15000 });
  check('a change on B appears on A live', true);

  // Edits travel too.
  await listHas(b, 'GitHub').click();
  await b.getByRole('button', { name: 'Edit' }).click();
  await b.getByLabel('Username or email').fill('samuel');
  await b.getByRole('button', { name: 'Save' }).click();
  await listHas(a, 'GitHub').click();
  await a.locator('.detail').getByText('samuel').waitFor({ timeout: 15000 });
  check('an edit on B updates A', true);

  // The sync panel lists both devices.
  await a.locator('.sync-chip').click();
  await a.locator('.device').nth(1).waitFor();
  await a.waitForTimeout(400); // let the dialog finish fading in
  check('both devices listed', (await a.locator('.device').count()) === 2);
  await shot(a, 'sync-3-panel.png');
  await a.keyboard.press('Escape');

  // Lock and unlock A: still connected.
  await a.getByRole('button', { name: 'Lock vault' }).click();
  await a.getByLabel('Master password').fill(master);
  await a.keyboard.press('Enter');
  await a.locator('.sync-chip', { hasText: 'Synced' }).waitFor({ timeout: 20000 });
  check('sync resumes after unlocking', true);

  // A changes the master password: B is signed out, signs in with the new one,
  // and from then on unlocks with it.
  const next = 'violet-anchor-quartz-meadow-ember-71';
  await a.getByRole('button', { name: 'Settings' }).first().click();
  await a.getByRole('button', { name: 'Change…' }).click();
  await a.getByLabel('Current master password', { exact: true }).fill(master);
  await a.getByLabel('New master password', { exact: true }).fill(next);
  await a.getByLabel('Confirm new master password').fill(next);
  await a.getByRole('button', { name: 'Change password' }).click();
  await a.getByText('Master password changed').waitFor();
  await b.locator('.sync-chip', { hasText: 'Sign in to sync' }).waitFor({ timeout: 15000 });
  check('changing the password signs the other device out', true);
  await b.locator('.sync-chip').click();
  await b.getByLabel('Master password').fill(next);
  await b.getByRole('button', { name: 'Sign in again' }).click();
  await b.locator('.sync-chip', { hasText: 'Synced' }).waitFor({ timeout: 20000 });
  await b.keyboard.press('Escape');
  await b.getByRole('button', { name: 'Lock vault' }).click();
  await b.getByLabel('Master password').fill(next);
  await b.keyboard.press('Enter');
  await listHas(b, 'Router').waitFor({ timeout: 20000 });
  check('the other device signs in again and unlocks with the new password', true);

  // Disconnecting keeps the vault here as a local one.
  await a.locator('.sync-chip').click();
  await a.getByRole('button', { name: 'Disconnect…' }).click();
  await a.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await a.locator('.sync-chip').waitFor({ state: 'detached' });
  check('disconnecting keeps the items', (await listHas(a, 'GitHub').count()) === 1);

  // B deletes the account: the server's copy goes, B keeps a local vault.
  await b.locator('.sync-chip').click();
  await b.getByRole('button', { name: 'Delete account…' }).click();
  await b.getByLabel('Master password').fill(next);
  await b.getByRole('button', { name: 'Delete account', exact: true }).click();
  await b.locator('.sync-chip').waitFor({ state: 'detached', timeout: 15000 });
  check('deleting the account keeps the local vault', (await listHas(b, 'Router').count()) === 1);

  check('no page errors or CSP violations', problems.length === 0, problems.join(' | '));
} catch (error) {
  failures++;
  console.error('ERROR', error);
  console.error(problems.join('\n'));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
