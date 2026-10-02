/**
 * Runs on pages only when "Offer to save new logins" is on and site access has
 * been granted. It notices sign-in forms being submitted and hands the
 * username and password to the extension, which offers to save them. It never
 * reads anything else from the page, and never fills: filling is done on
 * request, after the page's address has been checked.
 */
import type { ExtensionMessage } from '../shared/messages';

const TEXT_TYPES = ['text', 'email', 'tel'];
const USERNAME_HINT = /user|email|login|account|identifier|phone/i;

let lastSent = '';

function hint(input: HTMLInputElement): string {
  return `${input.autocomplete} ${input.name} ${input.id} ${input.placeholder}`;
}

function capture(root: ParentNode | null | undefined) {
  const scope = root ?? document;
  const passwords = [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    (input) => input.value,
  );
  if (passwords.length === 0) return;
  // On sign-up and change-password forms, the new password is the one to keep.
  const password = (
    passwords.find((input) => input.autocomplete === 'new-password') ?? passwords.at(-1)
  )?.value;
  if (!password) return;
  const texts = [...scope.querySelectorAll<HTMLInputElement>('input')].filter(
    (input) => TEXT_TYPES.includes(input.type) && input.value,
  );
  const username =
    texts.filter((input) => USERNAME_HINT.test(hint(input))).at(-1)?.value ??
    texts.at(-1)?.value ??
    '';
  const key = `${username}\u0000${password}`;
  if (key === lastSent) return;
  lastSent = key;
  const message: ExtensionMessage = { type: 'captured', username, password };
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

document.addEventListener('submit', (event) => capture(event.target as HTMLFormElement), true);

// Many sites sign in with a button and fetch(), never submitting a form.
document.addEventListener(
  'click',
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('button, input[type="submit"], [role="button"]');
    if (button) capture(button.closest('form'));
  },
  true,
);

document.addEventListener(
  'keydown',
  (event) => {
    const target = event.target;
    if (event.key === 'Enter' && target instanceof HTMLInputElement && target.type === 'password') {
      capture(target.form);
    }
  },
  true,
);
