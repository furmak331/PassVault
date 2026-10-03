import {
  DecryptionError,
  generatePassphrase,
  generateRandom,
  hostOf,
  matchingLogins,
  type Vault,
  type VaultHeader,
  type VaultItem,
} from '@passvaultify/core';
import {
  Avatar,
  Button,
  Fingerprint,
  Icon,
  IconButton,
  SecretText,
  Segmented,
  TextField,
} from '@passvaultify/ui';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import type { SyncStatus } from '@passvaultify/core';
import { hasSiteAccess, SITE_ACCESS } from '../shared/capture';
import { FILL_MESSAGES, fillLogin } from '../shared/fill';
import { saveIntent } from '../shared/logins';
import { send } from '../shared/messages';
import { clearPending, getPending, type PendingLogin } from '../shared/pending';
import { lock, openVault, touch, unlock, vaultHeader } from '../shared/session';
import { loadProfile, type ExtensionProfile } from '../shared/store';
import { Brand, hostLabel, isWebPage, useBodyTheme, useRings } from '../shared/ui';

type Phase =
  | { name: 'loading' }
  | { name: 'no-vault' }
  | { name: 'locked'; header: VaultHeader }
  | { name: 'unlocked'; vault: Vault };

/** The tab the popup acts on. Test builds can point it at a tab by ID. */
async function targetTab(): Promise<chrome.tabs.Tab | null> {
  const forced = new URLSearchParams(location.search).get('tab');
  if (import.meta.env.MODE === 'e2e' && forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

const openSettings = () => void chrome.runtime.openOptionsPage();

export function Popup() {
  const [profile, setProfile] = useState<ExtensionProfile | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  useBodyTheme(profile);

  /** Pull what other devices changed, then show it. */
  const syncAndRefresh = () =>
    void (send({ type: 'sync-vault' }) as Promise<SyncStatus | null>).then(async (status) => {
      setSync(status);
      if (!status) return;
      const fresh = await openVault();
      if (fresh) setPhase((p) => (p.name === 'unlocked' ? { name: 'unlocked', vault: fresh } : p));
    });

  useEffect(() => {
    void Promise.all([loadProfile(), vaultHeader(), targetTab(), openVault()]).then(
      ([loaded, header, active, vault]) => {
        setProfile(loaded);
        setTab(active);
        if (!header) setPhase({ name: 'no-vault' });
        else if (vault) {
          void touch();
          setPhase({ name: 'unlocked', vault });
          syncAndRefresh();
        } else setPhase({ name: 'locked', header });
      },
    );
  }, []);

  if (phase.name === 'loading' || !profile) return <div className="pop pop--loading" />;
  if (phase.name === 'no-vault') return <NoVault />;
  if (phase.name === 'locked') {
    return (
      <LockView
        header={phase.header}
        profile={profile}
        onUnlocked={(vault) => {
          setPhase({ name: 'unlocked', vault });
          syncAndRefresh();
        }}
      />
    );
  }
  return (
    <VaultView
      vault={phase.vault}
      tab={tab}
      sync={sync}
      onLock={() => {
        void lock().then(() => setPhase({ name: 'locked', header: phase.vault.header }));
      }}
    />
  );
}

function NoVault() {
  return (
    <div className="pop pop--center">
      <Brand />
      <h1 className="pv-display pop__title">
        Your vault, one click away<span className="dot">.</span>
      </h1>
      <p className="pop__lede">
        Bring your vault from the PassVaultify web app with a backup file, or start a new one here.
        Either way it's sealed on this device.
      </p>
      <Button variant="primary" size="lg" onClick={openSettings}>
        Set up PassVaultify
        <Icon name="arrow" />
      </Button>
    </div>
  );
}

function LockView({
  header,
  profile,
  onUnlocked,
}: {
  header: VaultHeader;
  profile: ExtensionProfile;
  onUnlocked: (vault: Vault) => void;
}) {
  const rings = useRings(header.fingerprint);
  const inputId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
          ? "That didn't open this vault. Check Caps Lock and try again."
          : String(err),
      );
    }
  };

  return (
    <div className="pop pop--lock" data-busy={busy || undefined}>
      <div className="pop__bar">
        <Brand />
        <IconButton icon="settings" label="Settings" onClick={openSettings} />
      </div>
      <div className="pop__dial">
        {rings && (
          <Fingerprint
            bytes={rings}
            size={132}
            bezel
            turn={busy ? 120 : password.length * 9}
            label={`Vault fingerprint ${header.fingerprint}`}
          />
        )}
      </div>
      <p className="pv-label">Locked</p>
      <h1 className="pv-display pop__vault">{profile.vaultName}</h1>
      <p className="pv-fp-code pop__code">{header.fingerprint}</p>
      <form className="combo pop__combo" onSubmit={(e) => void submit(e)}>
        <label htmlFor={inputId} className="pv-sr">
          Master password
        </label>
        <input
          id={inputId}
          className="combo__input"
          type="password"
          placeholder="Master password"
          autoComplete="current-password"
          autoFocus
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
          aria-label="Unlock"
          disabled={!password || busy}
        >
          {busy ? <span className="spinner" /> : <Icon name="arrow" />}
        </button>
      </form>
      {error && (
        <p className="pop__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type View = { name: 'list' } | { name: 'generator' } | { name: 'add'; password?: string };

function searchItems(items: VaultItem[], query: string): VaultItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const d = item.data;
    const text = [
      d.title,
      ...d.tags,
      ...(d.type === 'login' ? [d.username, ...d.urls.map((u) => hostOf(u) ?? u)] : []),
    ]
      .join('\n')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

function VaultView({
  vault,
  tab,
  sync,
  onLock,
}: {
  vault: Vault;
  tab: chrome.tabs.Tab | null;
  sync: SyncStatus | null;
  onLock: () => void;
}) {
  const [, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ name: 'list' });
  const [message, setMessage] = useState<{ text: string; tone?: 'warn' } | null>(null);
  const [pending, setPendingLogin] = useState<PendingLogin | null>(null);
  const [siteAccess, setSiteAccess] = useState(true);

  const url = isWebPage(tab?.url) ? tab?.url : undefined;
  const host = hostLabel(url);

  // Every save here goes to the sync server too. The background does it, so it
  // finishes even if the popup closes first.
  useEffect(
    () =>
      vault.onChange((change) => {
        if (change.source === 'local') void send({ type: 'sync-vault' });
      }),
    [vault],
  );
  const syncNeedsYou = sync?.state === 'signed-out' || sync?.state === 'error';

  useEffect(() => {
    if (tab?.id === undefined) return;
    void getPending(tab.id).then(setPendingLogin);
  }, [tab?.id]);

  useEffect(() => {
    void hasSiteAccess().then(setSiteAccess);
  }, []);

  // Chrome may close the popup while it asks; the background finishes turning it on.
  const turnOnAutofill = () =>
    void chrome.permissions.request(SITE_ACCESS).then((granted) => {
      setSiteAccess(granted);
      if (granted) say('Autofill is on. Click into a sign-in field to see it.');
    });

  const say = (text: string, tone?: 'warn') => setMessage(tone ? { text, tone } : { text });

  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => say(`${what} copied`),
      () => say(`Couldn't copy the ${what.toLowerCase()}`, 'warn'),
    );
    void touch();
  };

  const fill = async (item: VaultItem) => {
    if (tab?.id === undefined || item.data.type !== 'login') return;
    const outcome = await fillLogin(tab.id, item.data);
    if (outcome.ok) {
      await touch();
      window.close();
    } else {
      say(FILL_MESSAGES[outcome.reason], 'warn');
    }
  };

  const matches = url ? matchingLogins(vault.list(), url) : [];
  const matchIds = new Set(matches.map((m) => m.item.id));
  const results = query.trim()
    ? searchItems(vault.list(), query)
        .sort((a, b) => a.data.title.localeCompare(b.data.title))
        .slice(0, 50)
    : matches.map((m) => m.item);

  if (view.name === 'generator') {
    return (
      <GeneratorView
        onBack={() => setView({ name: 'list' })}
        onCopy={(value) => copy(value, 'Password')}
        onUse={(password) => setView({ name: 'add', password })}
        message={message}
      />
    );
  }
  if (view.name === 'add') {
    return (
      <AddView
        {...(view.password ? { password: view.password } : {})}
        url={url}
        onBack={() => setView({ name: 'list' })}
        onSave={async (values) => {
          await vault.add({ type: 'login', ...values });
          await touch();
          setView({ name: 'list' });
          setRevision((r) => r + 1);
          say('Saved');
        }}
      />
    );
  }

  return (
    <div className="pop">
      <div className="pop__bar">
        <Brand compact />
        <span className="site" title={url ?? 'Not a web page'}>
          <span className="site__lamp" data-on={Boolean(url) || undefined} />
          {host || 'No website'}
        </span>
        <span className="pop__tools">
          <IconButton
            icon="refresh"
            label="Password generator"
            onClick={() => setView({ name: 'generator' })}
          />
          <IconButton icon="settings" label="Settings" onClick={openSettings} />
          <IconButton icon="lock" label="Lock" onClick={onLock} />
        </span>
      </div>

      {pending && tab?.id !== undefined && (
        <SaveBanner
          vault={vault}
          pending={pending}
          onDone={(text) => {
            void clearPending(tab.id ?? -1);
            setPendingLogin(null);
            setRevision((r) => r + 1);
            if (text) say(text);
          }}
        />
      )}

      <label className="search pop__search">
        <Icon name="search" />
        <span className="pv-sr">Search the vault</span>
        <input
          type="search"
          placeholder="Search all logins"
          value={query}
          autoFocus={matches.length === 0}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <p className="pv-label pop__section">
        {query.trim() ? 'Search results' : host ? `On ${host}` : 'This tab'}
      </p>
      {results.length > 0 ? (
        <ul className="rows">
          {results.map((item) => (
            <Row
              key={item.id}
              item={item}
              canFill={matchIds.has(item.id)}
              onFill={() => void fill(item)}
              onCopy={copy}
            />
          ))}
        </ul>
      ) : (
        <EmptyState query={query} host={host} onAdd={() => setView({ name: 'add' })} />
      )}

      <div className="pop__foot">
        {message ? (
          <span className="pop__message" data-tone={message.tone} role="status">
            {message.text}
          </span>
        ) : !siteAccess ? (
          <button type="button" className="pop__hint pop__hint--on" onClick={turnOnAutofill}>
            Turn on autofill in sign-in fields
          </button>
        ) : syncNeedsYou ? (
          <button type="button" className="pop__hint pop__hint--warn" onClick={openSettings}>
            Sync needs you. Open settings
          </button>
        ) : (
          <span className="pop__hint">Only fills on the site a login was saved for.</span>
        )}
        <Button icon="plus" onClick={() => setView({ name: 'add' })}>
          Add
        </Button>
      </div>
    </div>
  );
}

function Row({
  item,
  canFill,
  onFill,
  onCopy,
}: {
  item: VaultItem;
  canFill: boolean;
  onFill: () => void;
  onCopy: (text: string, what: string) => void;
}) {
  const d = item.data;
  const seed = (d.type === 'login' && d.urls[0] && hostOf(d.urls[0])) || d.title;
  return (
    <li className="row">
      <Avatar title={d.title} seed={seed} size="sm" />
      <span className="row__text">
        <span className="row__title">{d.title}</span>
        <span className="row__sub">
          {d.type === 'login' ? d.username || 'No username' : 'Secure note'}
        </span>
      </span>
      {d.type === 'login' && (
        <span className="row__actions">
          {d.username && (
            <IconButton
              icon="copy"
              label="Copy username"
              onClick={() => onCopy(d.username, 'Username')}
            />
          )}
          {d.password && (
            <IconButton
              icon="key"
              label="Copy password"
              onClick={() => onCopy(d.password, 'Password')}
            />
          )}
          {canFill && (
            <Button variant="primary" className="row__fill" onClick={onFill}>
              Fill
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

function EmptyState({ query, host, onAdd }: { query: string; host: string; onAdd: () => void }) {
  if (query.trim()) {
    return <p className="pop__empty">Nothing matches “{query.trim()}”.</p>;
  }
  return (
    <div className="pop__empty">
      <p>{host ? `No logins saved for ${host} yet.` : 'Open a website to see its logins here.'}</p>
      {host && (
        <Button onClick={onAdd} icon="plus">
          Add a login for {host}
        </Button>
      )}
    </div>
  );
}

/** "Save this login?" or "Update the password?" after a sign-in form was submitted. */
function SaveBanner({
  vault,
  pending,
  onDone,
}: {
  vault: Vault;
  pending: PendingLogin;
  onDone: (message?: string) => void;
}) {
  const host = hostLabel(pending.url);
  const intent = saveIntent(vault, pending.url, pending.username, pending.password);
  const existing = intent.kind === 'update' ? intent.item : undefined;

  useEffect(() => {
    // Already saved exactly like this: nothing to ask.
    if (intent.kind === 'same') onDone();
  }, [intent.kind, onDone]);
  if (intent.kind === 'same') return null;

  const save = async () => {
    const origin = new URL(pending.url).origin;
    await vault.add({
      type: 'login',
      title: host,
      username: pending.username,
      password: pending.password,
      urls: [origin],
    });
    onDone(`Saved a login for ${host}`);
  };
  const update = async () => {
    if (!existing) return;
    await vault.update(existing.id, { password: pending.password });
    onDone(`Updated ${existing.data.title}. The old password is in its history.`);
  };

  return (
    <div className="save" role="alert">
      <p className="save__text">
        {existing ? (
          <>
            Update the password for <strong>{existing.data.title}</strong>?
          </>
        ) : (
          <>
            Save the login you just used on <strong>{host}</strong>?
          </>
        )}
        {pending.username && <span className="save__user">{pending.username}</span>}
      </p>
      <span className="save__actions">
        <Button onClick={() => onDone()}>Not now</Button>
        <Button variant="primary" onClick={() => void (existing ? update() : save())}>
          {existing ? 'Update' : 'Save'}
        </Button>
      </span>
    </div>
  );
}

function SubView({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="pop">
      <div className="pop__bar">
        <IconButton icon="back" label="Back" onClick={onBack} />
        <span className="pop__subtitle">{title}</span>
      </div>
      {children}
    </div>
  );
}

const MODES = [
  { value: 'random', label: 'Random' },
  { value: 'passphrase', label: 'Passphrase' },
] as const;

function GeneratorView({
  onBack,
  onCopy,
  onUse,
  message,
}: {
  onBack: () => void;
  onCopy: (value: string) => void;
  onUse: (value: string) => void;
  message: { text: string; tone?: 'warn' } | null;
}) {
  const make = (mode: 'random' | 'passphrase') =>
    mode === 'random' ? generateRandom({ length: 20 }) : generatePassphrase({ words: 5 });
  const [mode, setMode] = useState<'random' | 'passphrase'>('random');
  const [value, setValue] = useState(() => make('random'));
  return (
    <SubView title="Generator" onBack={onBack}>
      <div className="pop__body">
        <Segmented
          label="Kind"
          value={mode}
          options={MODES}
          onChange={(next) => {
            setMode(next);
            setValue(make(next));
          }}
        />
        <SecretText value={value.value} revealed size="lg" group={mode === 'random'} />
        <p className="pop__hint">{Math.round(value.bits)} bits of entropy</p>
        <div className="pop__actions">
          <Button icon="refresh" onClick={() => setValue(make(mode))}>
            New
          </Button>
          <Button icon="copy" onClick={() => onCopy(value.value)}>
            Copy
          </Button>
          <Button variant="primary" onClick={() => onUse(value.value)}>
            Save as login
          </Button>
        </div>
        {message && (
          <span className="pop__message" data-tone={message.tone} role="status">
            {message.text}
          </span>
        )}
      </div>
    </SubView>
  );
}

function AddView({
  url,
  password: initialPassword = '',
  onBack,
  onSave,
}: {
  url: string | undefined;
  password?: string;
  onBack: () => void;
  onSave: (values: {
    title: string;
    username: string;
    password: string;
    urls: string[];
  }) => Promise<void>;
}) {
  const host = hostLabel(url);
  const [title, setTitle] = useState(host);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(initialPassword);
  const [website, setWebsite] = useState(url ? new URL(url).origin : '');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    await onSave({
      title: title.trim(),
      username,
      password,
      urls: website.trim() ? [website.trim()] : [],
    });
  };
  return (
    <SubView title="New login" onBack={onBack}>
      <form className="pop__body" onSubmit={(e) => void submit(e)}>
        <TextField
          label="Title"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="Username or email"
          value={username}
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
        />
        <div className="pop__pw">
          <TextField
            label="Password"
            value={password}
            spellCheck={false}
            autoComplete="off"
            className="pv-input pop__mono"
            onChange={(e) => setPassword(e.target.value)}
          />
          <IconButton
            icon="refresh"
            label="Generate"
            onClick={() => setPassword(generateRandom({ length: 20 }).value)}
          />
        </div>
        <TextField
          label="Website"
          type="url"
          value={website}
          spellCheck={false}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <div className="pop__actions">
          <Button onClick={onBack}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!title.trim() || busy}>
            Save
          </Button>
        </div>
      </form>
    </SubView>
  );
}
