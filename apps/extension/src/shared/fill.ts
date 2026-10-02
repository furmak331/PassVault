import { matchUrl, type LoginItem } from '@passvaultify/core';

/**
 * Filling a login, in two steps:
 *
 * 1. Probe every frame of the tab we're allowed into: its URL and whether it
 *    has a visible password or username field.
 * 2. Fill only frames whose URL matches one of the login's saved sites
 *    (matchUrl: same host or a subdomain, https never downgraded). The fill
 *    function re-checks the frame's origin first, in case it navigated in
 *    between, so credentials can't land on a page that changed under us.
 *
 * Both functions run inside the page via chrome.scripting, so they're
 * serialized: they must not use anything from outside their own body.
 */

export interface FrameProbe {
  url: string;
  origin: string;
  passwordFields: number;
  usernameFields: number;
}

export function probeFrame(): FrameProbe {
  const visible = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    return (
      el.getClientRects().length > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !(el as HTMLInputElement).disabled
    );
  };
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')].filter(visible);
  return {
    url: location.href,
    origin: location.origin,
    passwordFields: inputs.filter((i) => i.type === 'password').length,
    usernameFields: inputs.filter((i) => ['text', 'email', 'tel'].includes(i.type)).length,
  };
}

export function fillFrame(
  expectedOrigin: string,
  username: string,
  password: string,
): { filled: number; reason?: string } {
  if (location.origin !== expectedOrigin) return { filled: 0, reason: 'navigated' };

  const visible = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    return (
      el.getClientRects().length > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      !(el as HTMLInputElement).disabled &&
      !(el as HTMLInputElement).readOnly
    );
  };
  // Set values the way typing does, so frameworks (React, Vue) see the change.
  const setValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    input.focus();
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const looksLikeUsername = (input: HTMLInputElement) => {
    const hint = `${input.autocomplete} ${input.name} ${input.id} ${input.placeholder} ${
      input.getAttribute('aria-label') ?? ''
    }`.toLowerCase();
    return /user|email|login|account|identifier|phone/.test(hint);
  };

  const inputs = [...document.querySelectorAll<HTMLInputElement>('input')].filter(visible);
  const passwordInput =
    inputs.find((i) => i.type === 'password' && i.autocomplete !== 'new-password') ??
    inputs.find((i) => i.type === 'password');
  const scope = passwordInput?.form ?? document;
  const textInputs = inputs.filter(
    (i) => ['text', 'email', 'tel'].includes(i.type) && (scope === document || i.form === scope),
  );
  // The username is usually just before the password field.
  const before = passwordInput
    ? textInputs.filter(
        (i) => i.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING,
      )
    : textInputs;
  const usernameInput =
    before.filter(looksLikeUsername).at(-1) ?? before.at(-1) ?? textInputs.find(looksLikeUsername);

  let filled = 0;
  if (usernameInput && username) {
    setValue(usernameInput, username);
    filled++;
  }
  if (passwordInput && password) {
    setValue(passwordInput, password);
    filled++;
  }
  return filled ? { filled } : { filled: 0, reason: 'no-fields' };
}

export type FillOutcome =
  { ok: true; filled: number } | { ok: false; reason: 'cant-access' | 'no-match' | 'no-fields' };

/** Fill a login into the given tab, only where the page belongs to the login's site. */
export async function fillLogin(tabId: number, item: LoginItem): Promise<FillOutcome> {
  let probes: chrome.scripting.InjectionResult<FrameProbe>[];
  try {
    probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: probeFrame,
    });
  } catch {
    // chrome:// pages, the Web Store, PDFs, or no permission for this tab.
    return { ok: false, reason: 'cant-access' };
  }

  const candidates = probes.filter(
    (p) => p.result && item.urls.some((url) => matchUrl(url, p.result?.url ?? '')),
  );
  if (candidates.length === 0) return { ok: false, reason: 'no-match' };

  let filled = 0;
  for (const frame of candidates) {
    const probe = frame.result;
    if (!probe || (probe.passwordFields === 0 && probe.usernameFields === 0)) continue;
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frame.frameId] },
      func: fillFrame,
      args: [probe.origin, item.username, item.password],
    });
    filled += result?.result?.filled ?? 0;
  }
  return filled ? { ok: true, filled } : { ok: false, reason: 'no-fields' };
}

export const FILL_MESSAGES: Record<Exclude<FillOutcome, { ok: true }>['reason'], string> = {
  'cant-access':
    "PassVaultify can't fill on this page. Browser pages and the Web Store are off limits.",
  'no-match': "This page isn't one of the login's saved sites, so nothing was filled.",
  'no-fields': 'No login fields found on this page.',
};
