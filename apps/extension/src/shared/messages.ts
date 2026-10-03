/** Messages sent to the background worker. */
export type ExtensionMessage =
  /**
   * From the content script: a sign-in or sign-up form was submitted. With no
   * password, it's the first step of a two-step sign-in (the email or username).
   */
  | { type: 'captured'; username: string; password: string }
  /** From the settings page: "offer to save" was switched, re-register the content script. */
  | { type: 'sync-capture' }
  /** From the popup or settings page: pull and push with the sync server now. */
  | { type: 'sync-vault' }
  /** From a content script: this frame wants in-page UI; remember which frame the token names. */
  | { type: 'frame-register'; token: string }
  /** From a content script: what to show for a focused login field. */
  | { type: 'field-check'; token: string }
  /** From a content script, on page load: is a save prompt waiting for this tab? */
  | { type: 'prompt-check'; token: string }
  /** From an in-page extension frame: which tab, frame and address a token belongs to. */
  | { type: 'frame-resolve'; token: string };

/** Messages to a content script, sent only by the extension (never by the page). */
export type ContentMessage =
  /** Fill the form around the field the menu was opened from. */
  | { type: 'fill'; token: string; username: string; password: string }
  /** Put a generated password into the new-password fields of that form. */
  | { type: 'fill-new-password'; token: string; password: string }
  /** An in-page frame's content height, so it can be sized without scrolling. */
  | { type: 'inline-size'; token: string; view: InlineView; height: number }
  /** Close an in-page frame; `refocus` puts the cursor back in the field. */
  | { type: 'inline-close'; token: string; view: InlineView; refocus?: boolean }
  /** Show the save/update bar (sent to the top frame after a submit). */
  | { type: 'show-save' };

export type InlineView = 'menu' | 'save';

/** What a focused login field should offer. */
export interface FieldCheck {
  /** False when the person turned the in-page menu off. */
  menu: boolean;
  locked: boolean;
  /** Saved logins for this frame's address; 0 while locked (unknown). */
  matches: number;
}

/** A registered frame: where a token's in-page UI belongs. */
export interface FrameInfo {
  tabId: number;
  frameId: number;
  /** The exact document, so a message can't reach whatever the frame navigates to next. */
  documentId: string;
  url: string;
}

export function send(message: ExtensionMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}
