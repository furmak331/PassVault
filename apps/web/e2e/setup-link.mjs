// Adding a device with a setup link, in Chromium, against a real server and the
// production build.
//
//   pnpm --filter @passvaultify/web build && pnpm --filter @passvaultify/web exec vite preview --port 4173 &
//   java -jar apps/server/target/passvaultify-server.jar &        # http://localhost:8080
//   SYNC_SERVER_URL=http://localhost:8080 node apps/web/e2e/setup-link.mjs [screenshot-dir]
//
// Checks: a connected device shows the link and a QR code; opening the link on
// a new device goes straight to signing in, with the fingerprint already
// checked; a link whose fingerprint doesn't match is refused; the link leaves
// the address bar; an email typed as the address gets a clear message.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const WEB = process.env.WEB_URL ?? 'http://localhost:4173/';
const SERVER = process.env.SYNC_SERVER_URL ?? 'http://localhost:8080';
const [shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const email = `link-${Date.now()}@example.com`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const problems = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

async function device(name, url = WEB) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${name} console: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  return page;
}

const shot = async (page, file) => shots && (await page.screenshot({ path: `${shots}/${file}` }));
const listHas = (page, title) => page.locator('.list-pane').getByText(title, { exact: true });

try {
  // Device A: a vault on "your own server", with one login.
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
  await a.locator('.side__new').click();
  await a.getByLabel('Title').fill('GitHub');
  await a.getByLabel('Username or email').fill('sam');
  await a.getByRole('button', { name: 'Save' }).click();
  await listHas(a, 'GitHub').waitFor();

  // An email typed as the server address gets a clear message, not "can't reach".
  await a.getByRole('button', { name: 'Set up sync' }).click();
  await a.getByLabel('Server address').fill(email);
  await a.getByRole('button', { name: 'Check server' }).click();
  await a.locator('.form-error').waitFor();
  check(
    'an email as the address says so',
    (await a.locator('.form-error').innerText()).includes("That's an email address"),
  );

  await a.getByLabel('Server address').fill(SERVER);
  await a.getByRole('button', { name: 'Check server' }).click();
  await a.getByLabel('Email').fill(email);
  await a.getByLabel('Master password').fill(master);
  await a.getByRole('button', { name: 'Create account' }).click();
  await a.locator('.sync-chip', { hasText: 'Synced' }).waitFor({ timeout: 20000 });

  // Sync → Add a device: a QR code and the link.
  await a.locator('.sync-chip').click();
  await a.getByRole('button', { name: 'Show link' }).click();
  await a.locator('.pv-qr').waitFor();
  const link = await a.locator('.add-device__link').innerText();
  const fingerprint = await a.locator('.server-id .pv-fp-code').first().innerText();
  check(
    'the link names the server and its fingerprint',
    link.startsWith(WEB) &&
      link.includes('#connect=') &&
      link.includes(`fp=${fingerprint.replaceAll(' ', '')}`),
    link,
  );
  check('a QR code is drawn', (await a.locator('.pv-qr path').getAttribute('d'))?.length > 100);
  await a.waitForTimeout(400);
  await shot(a, 'link-1-add-device.png');
  await a.keyboard.press('Escape');

  // Device B opens the link: straight to signing in, fingerprint already checked.
  const b = await device('B', link);
  await b.locator('.server-id__verified').waitFor({ timeout: 10000 });
  check('opening the link goes straight to signing in', true);
  check(
    'the fingerprint is checked against the link',
    (await b.locator('.server-id__verified').innerText()).includes('Matches your setup link'),
  );
  check('the link leaves the address bar', !b.url().includes('#'), b.url());
  await shot(b, 'link-2-opened.png');
  await b.getByLabel('Email').fill(email);
  await b.getByLabel('Master password').fill(master);
  await b.getByRole('button', { name: 'Sign in', exact: true }).click();
  await listHas(b, 'GitHub').waitFor({ timeout: 20000 });
  check('device B signs in and gets the vault', true);

  // A reload doesn't offer the link again.
  await b.reload({ waitUntil: 'networkidle' });
  await b.getByLabel('Master password').fill(master);
  await b.keyboard.press('Enter');
  await listHas(b, 'GitHub').waitFor({ timeout: 20000 });
  check('the link is not offered again', (await b.getByRole('dialog').count()) === 0);

  // A link whose fingerprint isn't the server's is refused.
  const forged = link.replace(/fp=[0-9A-F]+/, 'fp=000000000000');
  const c = await device('C', forged);
  await c.locator('.form-error').waitFor({ timeout: 10000 });
  const refusal = await c.locator('.form-error').innerText();
  check('a link with the wrong fingerprint is refused', refusal.includes('different fingerprint'));
  check('and goes no further', (await c.getByLabel('Email').count()) === 0);
  await shot(c, 'link-3-mismatch.png');

  // A device that already syncs is told so, not asked to connect again.
  // (A query string makes it a real page load, not just a fragment change.)
  await a.goto(link.replace('#', '?again=1#'), { waitUntil: 'networkidle' });
  await a.getByLabel('Master password').fill(master);
  await a.keyboard.press('Enter');
  await a.getByText(/already syncs with/).waitFor({ timeout: 10000 });
  check('a device that already syncs says so', true);
} catch (error) {
  failures++;
  console.error('ERROR', error);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log('\nPage errors:');
  for (const p of problems) console.log(`  ${p}`);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
