// End-to-end test of autofill on web pages: the menu under a sign-in field and
// the save bar, in the real extension in Chromium.
//
//   pnpm --filter @passvaultify/extension build:e2e
//   node apps/extension/e2e/inline.mjs [screenshot-dir]
//
// The e2e build has localhost access already, as if the person had turned
// autofill on. Checks: save after signing in (on the same page and after it
// moves on), suggest and fill on the next visit, nothing on a look-alike
// address, update a changed password, a two-step sign-in, a strong password on
// a sign-up form, "never for this site", and unlocking inside the menu.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startSite } from './site.mjs';

const EXT = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = 4176;
const SITE = `http://localhost:${PORT}`;
const LOOKALIKE = `http://127.0.0.1:${PORT}`;
const MASTER = 'river-lantern-copper-violet-ozone';
const [shots] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

/** The extension's frame in a page (menu or save bar), once it has loaded. */
async function inlineFrame(page, view, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = page
      .frames()
      .find((f) => f.url().includes('/inline.html') && f.url().includes(`view=${view}`));
    if (frame) {
      const ready = await frame
        .locator(view === 'menu' ? '.menu' : '.bar')
        .first()
        .waitFor({ timeout: Math.max(deadline - Date.now(), 1) })
        .then(() => true)
        .catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(100);
  }
  return null;
}

const values = (page, ...ids) =>
  page.evaluate((list) => list.map((id) => document.getElementById(id)?.value ?? null), ids);

const server = await startSite(PORT);
const browser = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : { channel: 'chromium' };
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pv-inline-')), {
  ...browser,
  headless: true,
  viewport: { width: 1100, height: 720 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const base = `chrome-extension://${new URL(worker.url()).host}`;

  // A new vault.
  const setup = await context.newPage();
  await setup.goto(`${base}/setup.html`);
  await setup.getByLabel('Master password', { exact: true }).fill(MASTER);
  await setup.getByLabel('Type it again').fill(MASTER);
  await setup.getByRole('switch').first().click();
  await setup.getByRole('button', { name: 'Create vault' }).click();
  await setup.locator('.vault-card').waitFor({ timeout: 20000 });
  check(
    'settings show autofill on, with no turn-on card',
    (await setup.locator('.autofill-card').count()) === 0 &&
      (await setup.getByRole('switch', { name: 'On' }).count()) === 2,
  );

  // 1. Sign in on a site with no saved login: the save bar offers to save it.
  const site = await context.newPage();
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  await site.waitForTimeout(600);
  check(
    'no menu opens by itself when there is nothing to offer',
    !(await inlineFrame(site, 'menu', 800)),
  );
  await site.fill('#email', 'sam@example.com');
  await site.fill('#password', 'First-Passw0rd');
  await site.click('button[type=submit]');
  let bar = await inlineFrame(site, 'save');
  check('save bar appears after signing in', !!bar);
  if (!bar) throw new Error('no save bar');
  check(
    'it offers to save a new login',
    (await bar.locator('.bar__title').innerText()).includes('Save this login for localhost'),
  );
  check(
    'with the username from the form',
    (await bar.locator('.bar__input').inputValue()) === 'sam@example.com',
  );
  if (shots) await site.screenshot({ path: `${shots}/inline-save.png` });
  await bar.getByRole('button', { name: 'Save', exact: true }).click();
  await bar.getByText('Saved a login for localhost').waitFor({ timeout: 5000 });
  check('saved from the bar', true);

  // 2. Next visit: focusing the field opens the menu with that login; a click fills.
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  let menu = await inlineFrame(site, 'menu');
  check('menu opens under the field with the saved login', !!menu);
  if (!menu) throw new Error('no menu');
  check(
    'it lists the login',
    (await menu.locator('.pick__sub').first().innerText()) === 'sam@example.com',
  );
  if (shots) await site.screenshot({ path: `${shots}/inline-menu.png` });
  await menu.locator('.pick').first().click();
  await site.waitForTimeout(300);
  let filled = await values(site, 'email', 'password');
  check(
    'a click fills username and password',
    filled[0] === 'sam@example.com' && filled[1] === 'First-Passw0rd',
    filled.join(' | '),
  );
  check('the menu closes after filling', !(await inlineFrame(site, 'menu', 500)));

  // Keyboard: arrow down into the menu, Enter to fill.
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  menu = await inlineFrame(site, 'menu');
  await site.keyboard.press('ArrowDown');
  await site.waitForTimeout(200);
  await site.keyboard.press('Enter');
  await site.waitForTimeout(300);
  filled = await values(site, 'email', 'password');
  check('arrow down and Enter fill it too', filled[1] === 'First-Passw0rd', filled.join(' | '));

  // 3. A look-alike address gets no menu and nothing filled.
  await site.goto(`${LOOKALIKE}/login`);
  await site.click('#email');
  check('no menu on a look-alike address', !(await inlineFrame(site, 'menu', 1200)));

  // 4. A changed password: the bar offers to update the saved login.
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  await site.keyboard.press('Escape');
  await site.fill('#email', 'sam@example.com');
  await site.fill('#password', 'Second-Passw0rd');
  await site.click('button[type=submit]');
  bar = await inlineFrame(site, 'save');
  check(
    'it offers to update the password',
    !!bar &&
      (await bar.locator('.bar__title').innerText()).includes('Update the password for localhost'),
  );
  if (shots) await site.screenshot({ path: `${shots}/inline-update.png` });
  await bar?.getByRole('button', { name: 'Update' }).click();
  await bar?.getByText(/Updated localhost/).waitFor({ timeout: 5000 });
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  menu = await inlineFrame(site, 'menu');
  check('still one login for the site', (await menu?.locator('.pick').count()) === 1);
  await menu?.locator('.pick').first().click();
  await site.waitForTimeout(300);
  filled = await values(site, 'password');
  check('it fills the new password', filled[0] === 'Second-Passw0rd', filled.join(' | '));

  // 5. Signing in again with the saved login asks nothing.
  await site.click('button[type=submit]');
  check('no bar when the login is already saved', !(await inlineFrame(site, 'save', 1200)));

  // 6. A sign-in that moves to another page: the bar follows to it.
  await site.goto(`${SITE}/away`);
  await site.fill('#email', 'alex@example.com');
  await site.fill('#password', 'Away-Passw0rd');
  await Promise.all([site.waitForURL(`${SITE}/home`), site.click('button[type=submit]')]);
  bar = await inlineFrame(site, 'save');
  check('the bar appears on the page after the sign-in', !!bar && site.url().endsWith('/home'));
  check('for that login', (await bar?.locator('.bar__input').inputValue()) === 'alex@example.com');
  await bar?.getByRole('button', { name: 'Not now' }).click();
  await site.waitForTimeout(300);
  check('"Not now" closes it', !(await inlineFrame(site, 'save', 500)));
  await site.reload();
  check('and it stays closed', !(await inlineFrame(site, 'save', 1000)));

  // 7. Two-step sign-in: the email from the first page is saved with the password.
  await site.goto(`${SITE}/step1`);
  await site.fill('#email', 'two@example.com');
  await Promise.all([site.waitForURL(`${SITE}/step2`), site.click('button[type=submit]')]);
  await site.fill('#password', 'Two-Step-Passw0rd');
  await Promise.all([site.waitForURL(`${SITE}/home`), site.click('button[type=submit]')]);
  bar = await inlineFrame(site, 'save');
  check(
    'two-step sign-in keeps the email for the save',
    (await bar?.locator('.bar__input').inputValue()) === 'two@example.com',
  );
  await bar?.getByRole('button', { name: 'Not now' }).click();

  // 8. Sign-up: the password field offers a strong password and fills it.
  await site.goto(`${SITE}/signup`);
  await site.fill('#user', 'newuser');
  await site.click('#pw');
  menu = await inlineFrame(site, 'menu');
  check(
    'sign-up field offers a strong password',
    !!menu && (await menu.getByText('Use a strong password').count()) === 1,
  );
  if (shots) await site.screenshot({ path: `${shots}/inline-generate.png` });
  const suggested = await menu?.locator('.pick__secret').innerText();
  await menu?.locator('.pick').first().click();
  await site.waitForTimeout(300);
  filled = await values(site, 'pw');
  check('it fills the new password', filled[0] === suggested && suggested.length === 20, filled[0]);
  await site.click('button[type=submit]');
  bar = await inlineFrame(site, 'save');
  check(
    'and offers to save the new account',
    (await bar?.locator('.bar__input').inputValue()) === 'newuser',
  );

  // 9. "Never for this site": no more bars here.
  await bar?.getByRole('button', { name: 'Never for localhost' }).click();
  await site.waitForTimeout(400);
  await site.goto(`${SITE}/signup`);
  await site.fill('#user', 'other');
  await site.fill('#pw', 'Other-Passw0rd');
  await site.click('button[type=submit]');
  check('"Never" stops the bar on that site', !(await inlineFrame(site, 'save', 1200)));
  await setup.bringToFront();
  await setup.reload();
  await setup.locator('.never-chip').first().waitFor({ timeout: 5000 });
  check(
    'settings list the site, with a way to undo',
    (await setup.locator('.never-chip').innerText()).includes('localhost'),
  );
  await setup.getByRole('button', { name: 'Ask again on localhost' }).click();
  await setup.waitForTimeout(300);
  check('removed from the list', (await setup.locator('.never-chip').count()) === 0);

  // 10. Locked: the menu asks for the master password inside its own frame.
  await setup.getByRole('button', { name: 'Lock' }).click();
  await setup.waitForTimeout(300);
  await site.bringToFront();
  await site.goto(`${SITE}/login`);
  await site.click('#email');
  menu = await inlineFrame(site, 'menu');
  check(
    'locked: the menu offers to unlock',
    !!menu && (await menu.getByText(/Unlock to fill/).count()) === 1,
  );
  if (shots) await site.screenshot({ path: `${shots}/inline-locked.png` });
  await menu?.locator('.combo__input').click();
  await menu?.locator('.combo__input').fill(MASTER);
  await menu?.locator('.combo__input').press('Enter');
  await menu?.locator('.pick').first().waitFor({ timeout: 15000 });
  check('unlocked in the menu, the login is listed', (await menu?.locator('.pick').count()) === 1);
  await menu?.locator('.pick').first().click();
  await site.waitForTimeout(300);
  filled = await values(site, 'email', 'password');
  check('and fills', filled[1] === 'Second-Passw0rd', filled.join(' | '));

  // 11. The page can't see the menu's insides or the session.
  const peek = await site.evaluate(() => {
    const host = document.querySelector('passvaultify-ui');
    return {
      found: !!host,
      shadow: host?.shadowRoot ?? null,
      chrome: typeof chrome !== 'undefined' && !!chrome.storage,
    };
  });
  check(
    'the page sees a closed box: no shadow root, no extension APIs',
    peek.found && peek.shadow === null && !peek.chrome,
  );
} catch (error) {
  failures++;
  console.error('ERROR', error);
} finally {
  await context.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
