// A tiny local website for the end-to-end tests: sign-in and sign-up pages that
// stay put (like a single-page app), a sign-in that moves to another page, and
// a two-step sign-in (email first, then password).
import { createServer } from 'node:http';

const page = (
  title,
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:40px}input{display:block;margin:8px 0;padding:8px;width:260px}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;

const stay = (text) =>
  `onsubmit="event.preventDefault();document.getElementById('out').textContent='${text}'"`;

const signIn = page(
  'Sign in',
  `<form id="signin" ${stay('submitted')}>
    <label>Email <input id="email" name="email" type="email" autocomplete="username"></label>
    <label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Sign in</button>
  </form><p id="out"></p>`,
);

const signUp = page(
  'Create account',
  `<form id="signup" ${stay('created')}>
    <label>Username <input id="user" name="username" type="text" autocomplete="username"></label>
    <label>Password <input id="pw" name="password" type="password" autocomplete="new-password"></label>
    <button type="submit">Create account</button>
  </form><p id="out"></p>`,
);

// Posts to /home, so the browser loads a new page right after the submit.
const signInAway = page(
  'Sign in',
  `<form id="signin" method="post" action="/home">
    <label>Email <input id="email" name="email" type="email"></label>
    <label>Password <input id="password" name="password" type="password"></label>
    <button type="submit">Sign in</button>
  </form>`,
);

const stepOne = page(
  'Sign in',
  `<form method="post" action="/step2">
    <label>Email <input id="email" name="email" type="email" autocomplete="username"></label>
    <button type="submit">Next</button>
  </form>`,
);

const stepTwo = page(
  'Enter your password',
  `<form method="post" action="/home">
    <label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Sign in</button>
  </form>`,
);

const home = page('Welcome back', '<p>You are signed in.</p>');

const ROUTES = {
  '/signup': signUp,
  '/away': signInAway,
  '/step1': stepOne,
  '/step2': stepTwo,
  '/home': home,
};

export function startSite(port) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    // Drain any posted form; nothing here reads it.
    req.resume();
    req.on('end', () => res.end(ROUTES[new URL(req.url ?? '/', 'http://x').pathname] ?? signIn));
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}
