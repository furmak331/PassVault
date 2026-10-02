import { normalizeItem, type LoginItem } from '@passvaultify/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { fillFrame, fillLogin, probeFrame, type FrameProbe } from '../src/shared/fill';
import { fakeChrome, type FakeChrome } from './chrome';

const login = (urls: string[]) =>
  normalizeItem(
    { type: 'login', title: 'Example', username: 'sam@example.com', password: 'hunter2', urls },
    '2026-10-02T00:00:00.000Z',
  ) as LoginItem;

const frame = (frameId: number, url: string, fields = 1) => ({
  frameId,
  documentId: `doc-${frameId}`,
  result: {
    url,
    origin: new URL(url).origin,
    passwordFields: fields,
    usernameFields: fields,
  } satisfies FrameProbe,
});

describe('fillLogin', () => {
  let chrome: FakeChrome;
  beforeEach(() => {
    chrome = fakeChrome();
  });

  it("reports pages it can't get into", async () => {
    chrome.scripting.executeScript.mockRejectedValueOnce(
      new Error('Cannot access a chrome:// URL'),
    );
    await expect(fillLogin(1, login(['https://example.com']))).resolves.toEqual({
      ok: false,
      reason: 'cant-access',
    });
  });

  it('never injects the fill into a page from another site', async () => {
    chrome.scripting.executeScript.mockResolvedValueOnce([
      frame(0, 'https://example.com.evil.test/login'),
    ]);
    await expect(fillLogin(1, login(['https://example.com']))).resolves.toEqual({
      ok: false,
      reason: 'no-match',
    });
    // Only the probe ran; the credentials were never passed to the page.
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('fills only the frames that belong to the login', async () => {
    chrome.scripting.executeScript
      .mockResolvedValueOnce([
        frame(0, 'https://news.test/article'),
        frame(7, 'https://accounts.example.com/embedded-login'),
      ])
      .mockResolvedValueOnce([{ frameId: 7, documentId: 'doc-7', result: { filled: 2 } }]);

    await expect(fillLogin(1, login(['https://example.com']))).resolves.toEqual({
      ok: true,
      filled: 2,
    });
    const fillCall = chrome.scripting.executeScript.mock.calls[1]?.[0];
    expect(fillCall.target).toEqual({ tabId: 1, frameIds: [7] });
    expect(fillCall.func).toBe(fillFrame);
    // The page re-checks this origin before writing anything.
    expect(fillCall.args).toEqual(['https://accounts.example.com', 'sam@example.com', 'hunter2']);
  });

  it('skips matching frames that have no login fields', async () => {
    chrome.scripting.executeScript.mockResolvedValueOnce([frame(0, 'https://example.com/', 0)]);
    await expect(fillLogin(1, login(['https://example.com']))).resolves.toEqual({
      ok: false,
      reason: 'no-fields',
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('probes every frame of the tab', async () => {
    chrome.scripting.executeScript.mockResolvedValueOnce([]);
    await fillLogin(3, login(['https://example.com']));
    expect(chrome.scripting.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 3, allFrames: true },
      func: probeFrame,
    });
  });
});
