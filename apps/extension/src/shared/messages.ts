/** Messages sent to the background worker. */
export type ExtensionMessage =
  /** From the content script: a sign-in form was submitted. */
  | { type: 'captured'; username: string; password: string }
  /** From the settings page: "offer to save" was switched, re-register the content script. */
  | { type: 'sync-capture' };

export function send(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}
