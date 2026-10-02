import { vi, type Mock } from 'vitest';

interface FakeArea {
  get: Mock;
  set: Mock;
  remove: Mock;
  /** Everything stored, for assertions. */
  dump: () => Record<string, unknown>;
}

export interface FakeChrome {
  storage: { local: FakeArea; session: FakeArea };
  alarms: { create: Mock; clear: Mock };
  scripting: { executeScript: Mock };
}

/** An in-memory stand-in for the parts of chrome.storage the extension uses. */
function area(): FakeArea {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return structuredClone(data);
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        wanted.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]),
      );
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      data = { ...data, ...structuredClone(items) };
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const gone = new Set(Array.isArray(keys) ? keys : [keys]);
      data = Object.fromEntries(Object.entries(data).filter(([key]) => !gone.has(key)));
    }),
    dump: () => data,
  };
}

/** Installs a fresh fake `chrome` global and returns it. */
export function fakeChrome(): FakeChrome {
  const chrome: FakeChrome = {
    storage: { local: area(), session: area() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    scripting: { executeScript: vi.fn() },
  };
  vi.stubGlobal('chrome', chrome);
  return chrome;
}
