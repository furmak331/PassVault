import { DecryptionError, generateRandom, type Vault } from '@passvaultify/core';
import { Avatar, Button, Icon, IconButton } from '@passvaultify/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { loginsFor, saveIntent, siteHost, type LoginEntry } from '../shared/logins';
import { send, type ContentMessage, type FrameInfo, type InlineView } from '../shared/messages';
import { clearPending, getPending, type PendingLogin } from '../shared/pending';
import { openVault, touch, unlock } from '../shared/session';
import { loadProfile, saveProfile, type ExtensionProfile } from '../shared/store';
import { Brand, useBodyTheme } from '../shared/ui';

/**
 * The menu under a login field and the save bar, shown inside web pages as
 * extension frames. The page can't read them, so the master password typed here
 * stays out of its reach. They know their page only by the token in their
 * address, which the background resolves to the tab, frame and document Chrome
 * reported for it; they act on nothing the page says.
 */
const params = new URLSearchParams(location.search);
const VIEW: InlineView = params.get('view') === 'save' ? 'save' : 'menu';
const TOKEN = params.get('token') ?? '';
const NEW_PASSWORD = params.get('kind') === 'new-password';

/** Message the content script of the exact document this frame was opened for. */
function tell(frame: FrameInfo, message: ContentMessage) {
  return chrome.tabs
    .sendMessage(frame.tabId, message, { documentId: frame.documentId })
    .catch(() => undefined);
}

const strongPassword = () => generateRandom({ length: 20 }).value;

export function Inline() {
  const [frame, setFrame] = useState<FrameInfo | null>();
  const [profile, setProfile] = useState<ExtensionProfile | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useBodyTheme(profile);

  useEffect(() => {
    void Promise.all([
      send({ type: 'frame-resolve', token: TOKEN }) as Promise<FrameInfo | null>,
      loadProfile(),
    ]).then(([resolved, loaded]) => {
      setProfile(loaded);
      setFrame(resolved ?? null);
    });
  }, []);

  // The page sizes this frame to its content, so nothing scrolls inside it.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !frame) return;
    const report = () =>
      void tell(frame, {
        type: 'inline-size',
        token: TOKEN,
        view: VIEW,
        height: Math.ceil(el.getBoundingClientRect().height),
      });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame]);

  const close = (refocus = false) => {
    if (frame) void tell(frame, { type: 'inline-close', token: TOKEN, view: VIEW, refocus });
  };

  return (
    <div ref={root} className="inline">
      {frame &&
        profile &&
        (VIEW === 'menu' ? (
          <Menu frame={frame} close={close} />
        ) : (
          <SaveBar frame={frame} profile={profile} close={close} />
        ))}
    </div>
  );
}

// ---------- The menu under a login field ----------

function Menu({ frame, close }: { frame: FrameInfo; close: (refocus?: boolean) => void }) {
  const host = siteHost(frame.url);
  const [vault, setVault] = useState<Vault | null>();

  useEffect(() => {
    void openVault().then(setVault);
  }, []);

  // The arrow key in the page's field moves focus into this frame: pick up from there.
  useEffect(() => {
    const onFocus = () => {
      if (document.activeElement === document.body) {
        document.querySelector<HTMLElement>('[data-pick], input')?.focus();
      }
    };
    addEventListener('focus', onFocus);
    return () => removeEventListener('focus', onFocus);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const picks = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-pick]')];
    if (!picks.length) return;
    event.preventDefault();
    const at = picks.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') picks[Math.min(at + 1, picks.length - 1)]?.focus();
    // Up from the first one goes back to the page's field.
    else if (at <= 0) close(true);
    else picks[at - 1]?.focus();
  };

  if (vault === undefined) return null;
  const title = NEW_PASSWORD ? 'Strong password' : vault ? host : 'Locked';
  return (
    <div className="menu" onKeyDown={onKeyDown}>
      <header className="menu__head">
        <Brand compact />
        <span className="menu__title">{title}</span>
        <IconButton icon="close" label="Close" onClick={() => close(true)} />
      </header>
      {NEW_PASSWORD ? (
        <Suggestion frame={frame} />
      ) : vault ? (
        <Logins vault={vault} frame={frame} host={host} />
      ) : (
        <Unlock
          prompt={`Unlock to fill your login for ${host}.`}
          action="Unlock"
          onUnlocked={setVault}
        />
      )}
    </div>
  );
}

function Logins({ vault, frame, host }: { vault: Vault; frame: FrameInfo; host: string }) {
  const logins = loginsFor(vault, frame.url);
  const fill = (item: LoginEntry) => {
    void tell(frame, {
      type: 'fill',
      token: TOKEN,
      username: item.data.username,
      password: item.data.password,
    });
    void touch();
  };

  if (!logins.length) {
    return (
      <p className="menu__note">
        No logins saved for {host} yet. Sign in, and PassVaultify will offer to save it.
      </p>
    );
  }
  return (
    <ul className="picks">
      {logins.map((item) => (
        <li key={item.id}>
          <button type="button" className="pick" data-pick onClick={() => fill(item)}>
            <Avatar title={item.data.title} seed={host} size="sm" />
            <span className="pick__text">
              <span className="pick__title">{item.data.title}</span>
              <span className="pick__sub">{item.data.username || 'No username'}</span>
            </span>
            <span className="pick__go" aria-hidden="true">
              Fill
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** On sign-up and change-password forms: a strong password, ready to use. */
function Suggestion({ frame }: { frame: FrameInfo }) {
  const [password, setPassword] = useState(strongPassword);
  return (
    <>
      <button
        type="button"
        className="pick"
        data-pick
        onClick={() => void tell(frame, { type: 'fill-new-password', token: TOKEN, password })}
      >
        <span className="pick__icon">
          <Icon name="key" />
        </span>
        <span className="pick__text">
          <span className="pick__title">Use a strong password</span>
          <span className="pick__sub pick__secret">{password}</span>
        </span>
      </button>
      <div className="menu__foot">
        <span className="menu__note">
          It goes into the new-password fields. PassVaultify offers to save it when you submit.
        </span>
        <IconButton
          icon="refresh"
          label="Another password"
          onClick={() => setPassword(strongPassword())}
        />
      </div>
    </>
  );
}

/** The master password, typed here inside the extension's own frame. */
function Unlock({
  prompt,
  action,
  onUnlocked,
}: {
  prompt: string;
  action: string;
  onUnlocked: (vault: Vault) => void;
}) {
  const inputId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      const vault = await openVault();
      if (vault) onUnlocked(vault);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof DecryptionError
          ? "That didn't open the vault. Check Caps Lock and try again."
          : String(err),
      );
    }
  };

  return (
    <form className="unlock" onSubmit={(e) => void submit(e)}>
      <label htmlFor={inputId} className="menu__note">
        {prompt}
      </label>
      <span className="combo">
        <input
          id={inputId}
          className="combo__input"
          type="password"
          placeholder="Master password"
          autoComplete="off"
          spellCheck={false}
          value={password}
          readOnly={busy}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        <button
          type="submit"
          className="combo__go"
          aria-label={action}
          disabled={!password || busy}
        >
          {busy ? <span className="spinner" /> : <Icon name="arrow" />}
        </button>
      </span>
      {error && (
        <p className="inline__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// ---------- The save bar ----------

function SaveBar({
  frame,
  profile,
  close,
}: {
  frame: FrameInfo;
  profile: ExtensionProfile;
  close: () => void;
}) {
  const [loaded, setLoaded] = useState<{ pending: PendingLogin; vault: Vault | null } | null>(null);

  useEffect(() => {
    void Promise.all([getPending(frame.tabId), openVault()]).then(async ([pending, vault]) => {
      // Nothing to ask when this exact login is already saved.
      const same =
        pending &&
        vault &&
        saveIntent(vault, pending.url, pending.username, pending.password).kind === 'same';
      if (pending && !same) {
        setLoaded({ pending, vault });
      } else {
        if (pending) await clearPending(frame.tabId);
        close();
      }
    });
    // Once, on open: the pending login is what it was when the bar was asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return null;
  return <SaveForm frame={frame} profile={profile} close={close} {...loaded} />;
}

function SaveForm({
  frame,
  profile,
  pending,
  vault: initialVault,
  close,
}: {
  frame: FrameInfo;
  profile: ExtensionProfile;
  pending: PendingLogin;
  vault: Vault | null;
  close: () => void;
}) {
  const host = siteHost(pending.url);
  const userId = useId();
  const masterId = useId();
  const [vault, setVault] = useState(initialVault);
  const [username, setUsername] = useState(pending.username);
  const [master, setMaster] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const intent = vault ? saveIntent(vault, pending.url, username, pending.password) : null;

  const finished = useRef(false);
  const finish = async (message: string | null) => {
    if (finished.current) return;
    finished.current = true;
    await clearPending(frame.tabId);
    if (!message) {
      close();
      return;
    }
    setDone(message);
    setTimeout(close, 1600);
  };

  const commit = async (open: Vault) => {
    const now = saveIntent(open, pending.url, username, pending.password);
    if (now.kind === 'new') {
      await open.add({
        type: 'login',
        title: host,
        username: username.trim(),
        password: pending.password,
        urls: [new URL(pending.url).origin],
      });
    } else if (now.kind === 'update') {
      await open.update(now.item.id, { password: pending.password });
    }
    await touch();
    void send({ type: 'sync-vault' });
    await finish(
      now.kind === 'new'
        ? `Saved a login for ${host}`
        : now.kind === 'update'
          ? `Updated ${now.item.data.title}. The old password is in its history.`
          : 'Already saved',
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let open = vault;
      if (!open) {
        await unlock(master);
        open = await openVault();
        if (!open) throw new Error('The vault locked again. Try once more.');
        setVault(open);
      }
      await commit(open);
    } catch (err) {
      setError(
        err instanceof DecryptionError
          ? "That didn't open the vault. Check Caps Lock and try again."
          : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const never = async () => {
    await saveProfile({ neverSave: [...new Set([...profile.neverSave, host])] });
    await finish(null);
  };

  if (done) {
    return (
      <div className="bar bar--done" role="status">
        <span className="bar__check">
          <Icon name="check" />
        </span>
        {done}
      </div>
    );
  }

  const updating = intent?.kind === 'update' ? intent.item : null;
  return (
    <form className="bar" onSubmit={(e) => void submit(e)}>
      <header className="menu__head">
        <Brand compact />
        <span className="bar__title">
          {updating ? (
            <>
              Update the password for <strong>{updating.data.title}</strong>?
            </>
          ) : (
            <>
              Save this login for <strong>{host}</strong>?
            </>
          )}
        </span>
        <IconButton icon="close" label="Close" onClick={() => void finish(null)} />
      </header>

      <div className="bar__fields">
        <label htmlFor={userId} className="bar__label">
          Username
        </label>
        {updating ? (
          <span className="bar__value">{updating.data.username || 'No username'}</span>
        ) : (
          <input
            id={userId}
            className="bar__input"
            value={username}
            placeholder="No username"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <span className="bar__label">Password</span>
        <span className="bar__value bar__secret">
          <span>
            {reveal ? pending.password : '•'.repeat(Math.min(pending.password.length, 16))}
          </span>
          <IconButton
            icon={reveal ? 'eyeOff' : 'eye'}
            label={reveal ? 'Hide password' : 'Show password'}
            onClick={() => setReveal(!reveal)}
          />
        </span>
      </div>

      {!vault && (
        <span className="unlock">
          <label htmlFor={masterId} className="menu__note">
            Your vault is locked. Enter the master password to save.
          </label>
          <input
            id={masterId}
            className="pv-input"
            type="password"
            placeholder="Master password"
            autoComplete="off"
            spellCheck={false}
            value={master}
            readOnly={busy}
            onChange={(e) => {
              setMaster(e.target.value);
              setError(null);
            }}
          />
        </span>
      )}
      {error && (
        <p className="inline__error" role="alert">
          {error}
        </p>
      )}

      <div className="bar__actions">
        <button type="button" className="bar__never" onClick={() => void never()}>
          Never for {host}
        </button>
        <Button onClick={() => void finish(null)}>Not now</Button>
        <Button type="submit" variant="primary" disabled={busy || (!vault && !master)}>
          {updating ? 'Update' : 'Save'}
        </Button>
      </div>
    </form>
  );
}
