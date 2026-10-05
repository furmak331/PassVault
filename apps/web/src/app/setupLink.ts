import { parseSetupLink, type SetupLink } from '@passvaultify/core';

/**
 * The setup link this page was opened with (from "Add a device" on another
 * device). It's removed from the address bar straight away, so a reload or a
 * bookmark doesn't replay it, and it's offered once.
 */
let pending: SetupLink | null = (() => {
  const link = parseSetupLink(location.hash);
  if (link) history.replaceState(null, '', `${location.pathname}${location.search}`);
  return link;
})();

/** The setup link waiting to be used, if any. */
export const pendingSetupLink = () => pending;

/** It's been acted on: don't offer it again. */
export function setupLinkUsed(): void {
  pending = null;
}

/** This web vault's own address, which setup links open. */
export const appUrl = () => `${location.origin}${location.pathname}`;
