// A tiny local website for the end-to-end test: a sign-in page and a sign-up page.
import { createServer } from 'node:http';

const page = (
  title,
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;margin:40px}input{display:block;margin:8px 0;padding:8px;width:260px}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;

const signIn = page(
  'Sign in',
  `<form id="signin" onsubmit="event.preventDefault();document.getElementById('out').textContent='submitted'">
    <label>Email <input id="email" name="email" type="email" autocomplete="username"></label>
    <label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
    <button type="submit">Sign in</button>
  </form><p id="out"></p>`,
);

const signUp = page(
  'Create account',
  `<form id="signup" onsubmit="event.preventDefault();document.getElementById('out').textContent='created'">
    <label>Username <input id="user" name="username" type="text" autocomplete="username"></label>
    <label>Password <input id="pw" name="password" type="password" autocomplete="new-password"></label>
    <button type="submit">Create account</button>
  </form><p id="out"></p>`,
);

export function startSite(port) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(req.url?.startsWith('/signup') ? signUp : signIn);
  });
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}
