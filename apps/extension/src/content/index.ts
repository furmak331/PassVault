/**
 * Runs on websites once the person grants site access (Settings → Autofill on
 * websites). It works from the field being focused:
 *
 * - Login fields get a small PassVaultify icon, and a menu of the logins saved
 *   for this site (or a strong password, on sign-up forms). The menu and the
 *   save bar are extension frames, so the page can't read them or what's typed
 *   into them, master password included.
 * - Filling happens only when the extension sends a fill message for this
 *   frame's token, over Chrome's private messaging; the page never sees
 *   credentials until they're in its own fields.
 * - Submitted sign-in and sign-up forms are passed to the extension, which
 *   offers to save or update the login.
 *
 * It reads nothing else from the page.
 */
import type { ContentMessage, ExtensionMessage, FieldCheck, InlineView } from '../shared/messages';

const EXT = chrome.runtime.getURL('');
const TEXT_TYPES = ['text', 'email', 'tel'];
const USERNAME_HINT = /user|e-?mail|login|account|identifier|phone|mobile/i;
const NEW_PASSWORD_HINT = /new|confirm|repeat|retype|again|create|regist|sign-?up|join/i;
// Fields that look like text inputs but are never logins.
const NOT_LOGIN =
  /search|query|captcha|otp|one.?time|verification|code|coupon|promo|zip|postal|card|cvv|cvc|amount/i;

type FieldKind = 'username' | 'password' | 'new-password';

/** After the extension is updated or removed, this copy can no longer reach it: fail quietly. */
function send(message: ExtensionMessage): Promise<unknown> {
  try {
    return chrome.runtime.sendMessage(message);
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

// ---------- This frame's token ----------

/** A v4 UUID from getRandomValues: crypto.randomUUID needs a secure context, and some logins don't have one. */
function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const token = uuid();
let registered: Promise<unknown> | null = null;
const ready = () => (registered ??= send({ type: 'frame-register', token }).catch(() => undefined));

// ---------- Recognising login fields ----------

function visible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 30 && rect.height > 12 && style.visibility !== 'hidden' && style.display !== 'none'
  );
}

function hintOf(input: HTMLInputElement): string {
  const label = input.labels?.[0]?.textContent ?? '';
  return `${input.autocomplete} ${input.name} ${input.id} ${input.placeholder} ${
    input.getAttribute('aria-label') ?? ''
  } ${label}`.toLowerCase();
}

/** The form a field belongs to, or the nearest thing that acts like one. */
function scopeOf(input: HTMLInputElement): ParentNode {
  return (
    input.form ??
    input.closest('[role="form"], dialog, form, section, main') ??
    (input.getRootNode() as Document | ShadowRoot)
  );
}

function passwordsIn(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (i) => visible(i) && !i.disabled,
  );
}

function textsIn(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input')].filter(
    (i) => TEXT_TYPES.includes(i.type) && visible(i) && !i.disabled,
  );
}

function isNewPassword(input: HTMLInputElement, scope: ParentNode): boolean {
  if (input.autocomplete === 'current-password') return false;
  if (input.autocomplete === 'new-password') return true;
  const others = passwordsIn(scope);
  if (others.some((i) => i.autocomplete === 'current-password')) return true;
  return others.length >= 2 || NEW_PASSWORD_HINT.test(hintOf(input));
}

function classify(input: HTMLInputElement): FieldKind | null {
  if (input.disabled || input.readOnly || !visible(input)) return null;
  const scope = scopeOf(input);
  if (input.type === 'password') return isNewPassword(input, scope) ? 'new-password' : 'password';
  if (!TEXT_TYPES.includes(input.type)) return null;
  const hint = hintOf(input);
  if (NOT_LOGIN.test(hint) && !/user|e-?mail|login/.test(hint)) return null;
  if (/\b(username|email)\b/.test(input.autocomplete)) return 'username';
  const passwords = passwordsIn(scope);
  if (passwords.length > 0) {
    const first = passwords[0];
    const before = first && input.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING;
    return USERNAME_HINT.test(hint) || before ? 'username' : null;
  }
  // The first step of a two-step sign-in: just an email or username.
  return USERNAME_HINT.test(hint) && textsIn(scope).length <= 2 ? 'username' : null;
}

// ---------- In-page UI: icon, menu, save bar ----------

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
const parts: { icon?: HTMLButtonElement; menu?: HTMLDivElement; bar?: HTMLDivElement } = {};

let current: { input: HTMLInputElement; kind: FieldKind } | null = null;
let menuOpen = false;
/** Set once the person waves the menu away: after that it opens only from the icon. */
let quiet = false;

const DIAL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="13" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="13" r="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9.5 2h5L12 4.8z" fill="#ec4a0f"/></svg>`;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  // A custom element in a closed shadow root: the page's CSS can't reach in,
  // and its scripts can't walk into it.
  host = document.createElement('passvaultify-ui');
  host.setAttribute(
    'style',
    'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;',
  );
  shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .icon { position: fixed; display: grid; place-items: center; width: 24px; height: 24px; padding: 0;
      border: 0; border-radius: 6px; background: transparent; color: #57544c; cursor: pointer; }
    .icon:hover { background: rgba(127,127,127,.16); color: #151513; }
    .frame { position: fixed; overflow: hidden; border-radius: 12px; background: #f1eee6;
      box-shadow: 0 0 0 1px rgba(0,0,0,.12), 0 18px 44px -12px rgba(0,0,0,.4); }
    .frame iframe { display: block; width: 100%; height: 100%; border: 0; }
    @media (prefers-color-scheme: dark) { .icon { color: #aaa69b; } .frame { background: #0e0e0c; } }
    [hidden] { display: none !important; }
  </style>
  <button class="icon" type="button" title="PassVaultify" hidden>${DIAL}</button>
  <div class="frame menu" hidden><iframe title="PassVaultify" allow=""></iframe></div>
  <div class="frame bar" hidden><iframe title="PassVaultify" allow=""></iframe></div>`;
  parts.icon = shadow.querySelector('.icon') as HTMLButtonElement;
  parts.menu = shadow.querySelector('.menu') as HTMLDivElement;
  parts.bar = shadow.querySelector('.bar') as HTMLDivElement;
  // Keep focus in the field when the icon is pressed.
  parts.icon.addEventListener('mousedown', (e) => e.preventDefault());
  parts.icon.addEventListener('click', (e) => {
    // Only a real click by the person, never one a script synthesised.
    if (!e.isTrusted) return;
    if (menuOpen) closeMenu();
    else void openMenu();
  });
  document.documentElement.appendChild(host);
  return shadow;
}

function frameUrl(view: InlineView, kind?: FieldKind): string {
  const params = new URLSearchParams({ view, token, ...(kind ? { kind } : {}) });
  return `${EXT}inline.html?${params.toString()}`;
}

/** Keeps the icon and menu next to the field as the page scrolls or resizes. */
function place() {
  if (!current || !parts.icon || !parts.menu) return;
  const rect = current.input.getBoundingClientRect();
  if (rect.width === 0 || rect.bottom < 0 || rect.top > innerHeight) {
    parts.icon.hidden = true;
    return;
  }
  parts.icon.style.left = `${rect.right - 30}px`;
  parts.icon.style.top = `${rect.top + rect.height / 2 - 12}px`;
  const width = Math.min(360, Math.max(rect.width, 300));
  const left = Math.min(Math.max(8, rect.left), innerWidth - width - 8);
  const height = parseFloat(parts.menu.style.height || '120');
  const below = rect.bottom + 6;
  const top =
    below + height > innerHeight - 8 && rect.top - height - 6 > 8 ? rect.top - height - 6 : below;
  parts.menu.style.left = `${left}px`;
  parts.menu.style.top = `${top}px`;
  parts.menu.style.width = `${width}px`;
}

let raf = 0;
const schedulePlace = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(place);
};

async function anchor(input: HTMLInputElement, kind: FieldKind) {
  await ready();
  const check = (await send({ type: 'field-check', token }).catch(() => null)) as FieldCheck | null;
  if (!check?.menu || deepActive() !== input) return;
  ui();
  current = { input, kind };
  if (parts.icon) parts.icon.hidden = false;
  place();
  // Open by itself only when it has something to offer: logins for this site, a
  // way to unlock to get at them, or a strong password for a new one.
  const helpful = kind === 'new-password' || check.locked || check.matches > 0;
  if (helpful && !quiet && !input.value) void openMenu();
}

function detach() {
  closeMenu();
  if (parts.icon) parts.icon.hidden = true;
  current = null;
}

async function openMenu() {
  if (!current || !parts.menu) return;
  const iframe = parts.menu.querySelector('iframe') as HTMLIFrameElement;
  parts.menu.style.height = '120px';
  iframe.src = frameUrl('menu', current.kind);
  parts.menu.hidden = false;
  menuOpen = true;
  place();
}

function closeMenu() {
  if (!parts.menu) return;
  parts.menu.hidden = true;
  (parts.menu.querySelector('iframe') as HTMLIFrameElement).src = 'about:blank';
  menuOpen = false;
}

async function openBar() {
  // The save bar belongs to the page as a whole, so only the top frame shows it.
  if (window !== window.top) return;
  await ready();
  ui();
  const bar = parts.bar;
  if (!bar) return;
  bar.style.top = '16px';
  bar.style.right = '16px';
  bar.style.width = '360px';
  bar.style.height = '150px';
  (bar.querySelector('iframe') as HTMLIFrameElement).src = frameUrl('save');
  bar.hidden = false;
}

function closeBar() {
  if (!parts.bar) return;
  parts.bar.hidden = true;
  (parts.bar.querySelector('iframe') as HTMLIFrameElement).src = 'about:blank';
}

/** The element really focused, looking inside open shadow roots (web components). */
const focusTarget = (event: Event) => event.composedPath()[0] ?? event.target;

function onFocusIn(event: FocusEvent) {
  const target = focusTarget(event);
  if (target === host) return; // Focus moved into our own menu.
  if (!(target instanceof HTMLInputElement)) {
    detach();
    return;
  }
  if (current?.input === target) return;
  detach();
  const kind = classify(target);
  if (kind) void anchor(target, kind);
}

function deepActive(): Element | null {
  let active = document.activeElement;
  // Open shadow roots only: our own is closed, so focus inside the menu reads as the host.
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function onFocusOut(event: FocusEvent) {
  if (focusTarget(event) !== current?.input) return;
  // Leave the menu open if focus went into it.
  setTimeout(() => {
    const active = deepActive();
    if (active !== host && active !== current?.input) detach();
  }, 120);
}

function onMouseDown(event: MouseEvent) {
  if (!menuOpen) return;
  const path = event.composedPath();
  if (host && path.includes(host)) return;
  if (current && path.includes(current.input)) return;
  quiet = true;
  closeMenu();
}

function onKeyDown(event: KeyboardEvent) {
  if (!menuOpen || !current || focusTarget(event) !== current.input) return;
  if (event.key === 'Escape') {
    quiet = true;
    closeMenu();
  } else if (event.key === 'ArrowDown' && event.isTrusted) {
    // Into the menu, so the arrow keys and Enter pick a login.
    event.preventDefault();
    parts.menu?.querySelector('iframe')?.focus();
  }
}

// Typing your own value: get out of the way.
function onInput(event: Event) {
  if (menuOpen && event.isTrusted && focusTarget(event) === current?.input) closeMenu();
}

// ---------- Filling, on the extension's word only ----------

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  input.focus();
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillLogin(anchorInput: HTMLInputElement, username: string, password: string) {
  const scope = scopeOf(anchorInput);
  const passwords = passwordsIn(scope);
  const passwordInput =
    passwords.find((i) => i.autocomplete !== 'new-password' && !isNewPassword(i, scope)) ??
    passwords[0];
  const texts = textsIn(scope);
  const before = passwordInput
    ? texts.filter(
        (i) => i.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
    : texts;
  const usernameInput =
    (anchorInput.type !== 'password' ? anchorInput : undefined) ??
    before.filter((i) => USERNAME_HINT.test(hintOf(i))).at(-1) ??
    before.at(-1);
  if (usernameInput && username) setValue(usernameInput, username);
  if (passwordInput && password) setValue(passwordInput, password);
}

function fillNewPassword(anchorInput: HTMLInputElement, password: string) {
  const scope = scopeOf(anchorInput);
  for (const input of passwordsIn(scope)) {
    if (input.autocomplete === 'current-password') continue;
    if (isNewPassword(input, scope)) setValue(input, password);
  }
}

/**
 * A fill must come from the person using our menu: it's on screen, and focus is
 * inside its frame (a click or the arrow keys put it there). The page can't
 * focus that frame itself, since it can't reach into the closed shadow root, so
 * a copy of the menu it framed, or our menu hidden under something else, can't
 * fill anything.
 */
function menuInUse(): boolean {
  if (!host || !shadow || !parts.menu || parts.menu.hidden) return false;
  if (shadow.activeElement !== parts.menu.querySelector('iframe')) return false;
  for (const el of [host, document.documentElement, document.body]) {
    if (!el) continue;
    const style = getComputedStyle(el);
    if (Number(style.opacity) < 1 || style.visibility === 'hidden' || style.display === 'none') {
      return false;
    }
  }
  return true;
}

function onMessage(message: ContentMessage, sender: chrome.runtime.MessageSender) {
  // Only the extension itself talks to this script; pages can't reach it.
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'show-save') {
    void openBar();
    return;
  }
  if (message.token !== token) return;
  if ((message.type === 'fill' || message.type === 'fill-new-password') && !menuInUse()) return;
  if (message.type === 'fill' && current) {
    fillLogin(current.input, message.username, message.password);
    closeMenu();
  } else if (message.type === 'fill-new-password' && current) {
    fillNewPassword(current.input, message.password);
    closeMenu();
  } else if (message.type === 'inline-size') {
    const frame = message.view === 'menu' ? parts.menu : parts.bar;
    if (frame) frame.style.height = `${Math.min(Math.max(message.height, 40), 520)}px`;
    if (message.view === 'menu') place();
  } else if (message.type === 'inline-close') {
    if (message.view === 'menu') {
      quiet = true;
      closeMenu();
      if (message.refocus) current?.input.focus();
    } else closeBar();
  }
}

// ---------- Noticing submitted logins ----------

let lastSent = '';

function capture(root: ParentNode | null | undefined) {
  const scope = root ?? document;
  const passwords = [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (input) => input.value,
  );
  const texts = [...scope.querySelectorAll<HTMLInputElement>('input')].filter(
    (input) => (TEXT_TYPES.includes(input.type) || input.type === 'hidden') && input.value,
  );
  const named = texts.filter(
    (input) => USERNAME_HINT.test(hintOf(input)) || /username|email/.test(input.autocomplete),
  );
  const username = (named.at(-1) ?? texts.filter((i) => i.type !== 'hidden').at(-1))?.value ?? '';
  // On sign-up and change-password forms, the new password is the one to keep.
  const password =
    (passwords.find((input) => input.autocomplete === 'new-password') ?? passwords.at(-1))?.value ??
    '';
  // A two-step sign-in's first step: remember the username for the next page.
  if (!password && (!username || named.length === 0)) return;
  const key = `${username}\u0000${password}`;
  if (key === lastSent) return;
  lastSent = key;
  void ready().then(() => send({ type: 'captured', username: username.slice(0, 500), password }));
}

const SUBMIT_TEXT =
  /sign|log|continue|next|submit|create|register|join|save|update|change|confirm/i;

/** A button that sends the form, not one that shows the password or opens a menu. */
function submits(button: Element): boolean {
  if (button instanceof HTMLInputElement) return button.type === 'submit';
  if (button instanceof HTMLButtonElement && button.type === 'submit' && button.form) return true;
  const label = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''} ${button.id}`;
  return SUBMIT_TEXT.test(label.slice(0, 200));
}

// Many sites sign in with a button and fetch(), never submitting a form.
function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('button, input[type="submit"], [role="button"]');
  if (button && submits(button)) {
    capture(button.closest('form') ?? button.closest('[role="form"], dialog, section, main'));
  }
}

function onEnter(event: KeyboardEvent) {
  const target = focusTarget(event);
  if (
    event.key === 'Enter' &&
    target instanceof HTMLInputElement &&
    TEXT_TYPES.concat('password').includes(target.type)
  ) {
    capture(target.form ?? scopeOf(target));
  }
}

// ---------- Start ----------

function start() {
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('input', onInput, true);
  addEventListener('scroll', schedulePlace, true);
  addEventListener('resize', schedulePlace);
  chrome.runtime.onMessage.addListener(onMessage);

  document.addEventListener('submit', (event) => capture(event.target as HTMLFormElement), true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onEnter, true);

  // A field already focused when the script arrived (autofocus, or just installed).
  const active = deepActive();
  if (active instanceof HTMLInputElement) {
    const kind = classify(active);
    if (kind) void anchor(active, kind);
  }

  // After a sign-in the site usually moves to another page: ask whether a save
  // prompt is waiting for this tab.
  if (window === window.top) {
    void ready()
      .then(() => send({ type: 'prompt-check', token }))
      .then((reply) => {
        if ((reply as { show?: boolean } | undefined)?.show) void openBar();
      })
      .catch(() => undefined);
  }
}

// Started once per page, even if the extension injects this script again.
const STARTED = '__passvaultifyStarted';
const scope = globalThis as unknown as Record<string, boolean>;
if (!scope[STARTED]) {
  scope[STARTED] = true;
  start();
}
