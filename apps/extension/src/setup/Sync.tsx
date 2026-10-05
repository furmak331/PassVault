import {
  buildSetupLink,
  checkServer,
  compareVaults,
  createSyncAccount,
  mergeItemsInto,
  signInToSync,
  SyncClient,
  SyncEngine,
  SyncError,
  unlockVault,
  unwrapVaultKey,
  type ServerInfo,
  type SyncSettings,
  type SyncStatus,
  type VaultHeader,
} from '@passvaultify/core';
import {
  Button,
  Dialog,
  Fingerprint,
  Icon,
  QrCode,
  Segmented,
  TextField,
  useToast,
} from '@passvaultify/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { send } from '../shared/messages';
import { openVault, startSession } from '../shared/session';
import { ChromeStore } from '../shared/store';
import {
  extensionDeviceName,
  hostOf,
  loadSyncSettings,
  loadSyncStatus,
  saveSyncSettings,
  scheduleSync,
} from '../shared/sync';
import { useRings, WEB_VAULT_URL } from '../shared/ui';

/** Ask the background worker to sync now; it keeps going if this page closes. */
const syncNow = () => send({ type: 'sync-vault' }) as Promise<SyncStatus | null>;

const device = () => ({ name: extensionDeviceName(), kind: 'extension' as const });

export function syncErrorText(error: unknown): string {
  if (error instanceof SyncError) return error.message;
  if (error instanceof TypeError) {
    return "Can't reach that server. Check the address, and that it's running with HTTPS.";
  }
  if (error instanceof Error && error.name === 'DecryptionError') {
    return "That password doesn't open this vault.";
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------- Shared steps ----------

type Checked = { server: string; info: ServerInfo; verified: boolean };

/** An address, or a setup link from "Add a device" on a device that's already connected. */
function ServerForm({ onChecked }: { onChecked: (checked: Checked) => void }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChecked(await checkServer(address));
    } catch (err) {
      setBusy(false);
      setError(syncErrorText(err));
    }
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <TextField
        label="Server address or setup link"
        placeholder="vault.example.com"
        inputMode="url"
        spellCheck={false}
        autoComplete="url"
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          setError(null);
        }}
        hint="On a device that's already connected, Sync → Add a device gives a link to paste here."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" icon="server" disabled={!address.trim() || busy}>
        {busy ? 'Checking…' : 'Check server'}
      </Button>
    </form>
  );
}

function ServerIdentity({
  server,
  fingerprint,
  verified,
}: {
  server: string;
  fingerprint: string;
  /** The fingerprint matched a setup link, so there's nothing to compare by eye. */
  verified: boolean;
}) {
  const rings = useRings(fingerprint);
  return (
    <div className="server-id">
      {rings && <Fingerprint bytes={rings} size={64} glyph="none" />}
      <div className="server-id__text">
        <strong>{hostOf(server)}</strong>
        <span className="pv-fp-code">{fingerprint}</span>
        {verified ? (
          <span className="server-id__verified">
            <Icon name="check" />
            Matches your setup link
          </span>
        ) : (
          <span className="hint">
            The server's fingerprint. Check it matches {hostOf(server)}/v1/server before signing in.
          </span>
        )}
      </div>
    </div>
  );
}

type Mode = 'create' | 'signin';

function AccountForm({
  server,
  info,
  verified,
  allowCreate,
  onSubmit,
}: {
  server: string;
  info: ServerInfo;
  verified: boolean;
  allowCreate: boolean;
  onSubmit: (mode: Mode, email: string, password: string) => Promise<void>;
}) {
  const canCreate = allowCreate && info.registration === 'open';
  const [mode, setMode] = useState<Mode>(canCreate ? 'create' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(mode, email.trim(), password);
    } catch (err) {
      setBusy(false);
      setError(syncErrorText(err));
    }
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <ServerIdentity server={server} fingerprint={info.fingerprint} verified={verified} />
      {allowCreate && (
        <Segmented
          label="Account"
          value={mode}
          options={[
            { value: 'create', label: 'Create an account', disabled: !canCreate },
            { value: 'signin', label: 'Sign in' },
          ]}
          onChange={setMode}
        />
      )}
      <TextField
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Master password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint={
          mode === 'create'
            ? "This vault's master password. The server only gets a key derived from it."
            : 'The master password of the vault on that account.'
        }
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={!email || !password || busy}>
        {busy ? 'Working…' : mode === 'create' ? 'Create account and sync' : 'Sign in and sync'}
      </Button>
    </form>
  );
}

// ---------- First run: this browser joins a vault on a server ----------

export function SignInForm({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const [server, setServer] = useState<Checked | null>(null);
  if (!server) return <ServerForm onChecked={setServer} />;
  return (
    <AccountForm
      server={server.server}
      info={server.info}
      verified={server.verified}
      allowCreate={false}
      onSubmit={async (_mode, email, password) => {
        const { settings, header } = await signInToSync({
          server: server.server,
          serverFingerprint: server.info.fingerprint,
          email,
          password,
          device: device(),
        });
        onStart();
        const store = new ChromeStore();
        await store.clear();
        await store.saveHeader(header);
        await saveSyncSettings(settings);
        await startSession(await unwrapVaultKey(password, header));
        await scheduleSync();
        await syncNow();
        onDone();
      }}
    />
  );
}

// ---------- Settings: the Sync section ----------

export function SyncSection({ unlocked }: { unlocked: boolean }) {
  const [settings, setSettings] = useState<SyncSettings | null | undefined>(undefined);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const read = () => {
      void Promise.all([loadSyncSettings(), loadSyncStatus()]).then(([s, st]) => {
        setSettings(s);
        setStatus(st);
      });
    };
    read();
    chrome.storage.onChanged.addListener(read);
    return () => chrome.storage.onChanged.removeListener(read);
  }, []);

  if (settings === undefined) return null;

  if (!settings) {
    return (
      <>
        <div className="setting">
          <span className="setting__label">
            Sync with your server
            <span className="setting__hint">
              Keep this vault in step with the web app and your other devices, through a
              PassVaultify server you run. It only ever holds ciphertext.
            </span>
          </span>
          <span className="setting__control">
            <Button icon="server" disabled={!unlocked} onClick={() => setConnectOpen(true)}>
              {unlocked ? 'Connect…' : 'Unlock to connect'}
            </Button>
          </span>
        </div>
        <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
      </>
    );
  }

  const attention = status?.state === 'signed-out' || status?.state === 'error';
  return (
    <>
      <div className="setting">
        <span className="setting__label">
          <span>
            Synced through {hostOf(settings.server)}
            <span className="sync-lamp" data-state={status?.state ?? 'idle'} aria-hidden="true" />
          </span>
          <span className="setting__hint">
            Signed in as {settings.email}. {statusText(status, unlocked)}
          </span>
        </span>
        <span className="setting__control">
          <Button
            icon="refresh"
            disabled={!unlocked || attention}
            onClick={() =>
              void syncNow().then((s) =>
                toast(s?.state === 'idle' ? 'Up to date' : (s?.message ?? 'Sync is waiting')),
              )
            }
          >
            Sync now
          </Button>
        </span>
      </div>
      {status?.state === 'signed-out' && unlocked && <SignInAgain settings={settings} />}
      <AddDevice settings={settings} />
      <div className="setting">
        <span className="setting__label">
          Stop syncing in this browser
          <span className="setting__hint">The vault stays here; the server keeps its copy.</span>
        </span>
        <span className="setting__control">
          {confirmDisconnect ? (
            <span className="inline-actions">
              <Button onClick={() => setConfirmDisconnect(false)}>Keep</Button>
              <Button variant="danger" onClick={() => void disconnect(settings)}>
                Disconnect
              </Button>
            </span>
          ) : (
            <Button onClick={() => setConfirmDisconnect(true)}>Disconnect…</Button>
          )}
        </span>
      </div>
    </>
  );
}

/** A link and QR code that set another device up for this server, fingerprint included. */
function AddDevice({ settings }: { settings: SyncSettings }) {
  const [shown, setShown] = useState(false);
  const toast = useToast();
  const link = buildSetupLink(WEB_VAULT_URL, settings.server, settings.serverFingerprint);
  return (
    <>
      <div className="setting">
        <span className="setting__label">
          Add a device
          <span className="setting__hint">
            A link that sets up the web vault on another device for this server, and checks its
            fingerprint for you.
          </span>
        </span>
        <span className="setting__control">
          <Button icon={shown ? 'close' : 'plus'} onClick={() => setShown(!shown)}>
            {shown ? 'Hide' : 'Show link'}
          </Button>
        </span>
      </div>
      {shown && (
        <div className="add-device">
          <QrCode value={link} size={160} label={`Setup link for ${hostOf(settings.server)}`} />
          <div className="add-device__text">
            <p>
              <strong>Phone:</strong> scan the code with the camera.{' '}
              <strong>Another computer:</strong> open the link.{' '}
              <strong>The extension in another browser:</strong> paste it into Server address.
            </p>
            <code className="add-device__link">{link}</code>
            <Button
              icon="copy"
              onClick={() =>
                void navigator.clipboard.writeText(link).then(
                  () => toast('Setup link copied'),
                  () => toast("Couldn't copy the link"),
                )
              }
            >
              Copy link
            </Button>
            <p className="hint">
              It holds only the server's address and fingerprint, so it's safe to send. The new
              device still needs your email and master password, and has to be able to reach the
              server (for a server at home, with Tailscale on).
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function statusText(status: SyncStatus | null, unlocked: boolean): string {
  if (!unlocked) return 'Unlock the vault to sync.';
  if (!status) return 'Not synced yet.';
  switch (status.state) {
    case 'idle':
      return status.pending ? `${status.pending} changes waiting.` : 'Up to date.';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return "Can't reach the server right now; changes wait here.";
    case 'signed-out':
      return 'This browser was signed out. Sign in again below.';
    case 'error':
      return status.message ?? 'Sync stopped.';
  }
}

/** Sign out of the server (if it can be reached) and keep the vault as a local one. */
export async function disconnect(settings: SyncSettings): Promise<void> {
  await new SyncClient({ server: settings.server, tokens: settings.tokens })
    .logout()
    .catch(() => undefined);
  await saveSyncSettings(null);
  await scheduleSync();
}

function SignInAgain({ settings }: { settings: SyncSettings }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <form
      className="stack sign-in-again"
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          const client = new SyncClient({ server: settings.server });
          const header = await client.login(settings.email, password, device());
          const vault = await openVault();
          if (!vault || compareVaults(vault.header, header) === 'different') {
            await client.logout();
            throw new Error('This account now holds a different vault.');
          }
          // Changed on another device: the new header opens with the password just typed.
          if (header.wrappedVaultKey !== vault.header.wrappedVaultKey) {
            await unlockVault(password, header);
            await vault.adoptHeader(header);
          }
          await saveSyncSettings({ ...settings, tokens: client.getTokens() });
          await syncNow();
          toast('Signed in. Syncing again');
        })().catch((err: unknown) => {
          setBusy(false);
          setError(syncErrorText(err));
        });
      }}
    >
      <TextField
        label="Master password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="If you changed it on another device, use the new one."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={!password || busy}>
        {busy ? 'Signing in…' : 'Sign in again'}
      </Button>
    </form>
  );
}

type Stage =
  | { name: 'server' }
  | ({ name: 'account' } & Checked)
  | { name: 'different'; settings: SyncSettings; header: VaultHeader; password: string };

/** Connect the vault already in this browser: a new account from it, or sign in to one. */
function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'server' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const close = (next: boolean) => {
    if (!next) setStage({ name: 'server' });
    onOpenChange(next);
  };

  const finish = async (settings: SyncSettings, message: string) => {
    await saveSyncSettings(settings);
    await scheduleSync();
    close(false);
    toast(message);
    await syncNow();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Connect a sync server"
      description="Your vault is encrypted here before anything is sent. The server stores ciphertext it has no key for."
    >
      {stage.name === 'server' && (
        <ServerForm onChecked={(checked) => setStage({ name: 'account', ...checked })} />
      )}
      {stage.name === 'account' && (
        <AccountForm
          server={stage.server}
          info={stage.info}
          verified={stage.verified}
          allowCreate
          onSubmit={async (mode, email, password) => {
            const vault = await openVault();
            if (!vault) throw new Error('Unlock the vault first.');
            const options = {
              server: stage.server,
              serverFingerprint: stage.info.fingerprint,
              email,
              password,
              device: device(),
            };
            if (mode === 'create') {
              await finish(
                await createSyncAccount(vault, options),
                'Connected. Uploading your vault',
              );
              return;
            }
            const { settings, header } = await signInToSync(options);
            if (compareVaults(vault.header, header) === 'different') {
              setStage({ name: 'different', settings, header, password });
              return;
            }
            if (header.wrappedVaultKey !== vault.header.wrappedVaultKey) {
              await unlockVault(password, header);
              await vault.adoptHeader(header);
            }
            await vault.resetSync();
            await finish(settings, 'Connected. Merging with your server');
          }}
        />
      )}
      {stage.name === 'different' && (
        <div className="stack">
          <p>
            That account already has a vault, and it isn't the one in this browser. Switch to it?
            The items here are added to it, skipping ones it already has, and from then on the
            extension opens with the account's master password.
          </p>
          <div className="dialog-actions">
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void joinVault(stage.settings, stage.header, stage.password).then(
                  () => {
                    close(false);
                    toast('Switched to the vault on your server');
                  },
                  (err: unknown) => {
                    setBusy(false);
                    toast(syncErrorText(err));
                  },
                );
              }}
            >
              {busy ? 'Switching…' : 'Switch to that vault'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** Replace this browser's vault with the account's, bringing its items across. */
async function joinVault(settings: SyncSettings, header: VaultHeader, password: string) {
  const current = await openVault();
  const items = current ? [...current.list(), ...current.trash()].map((i) => i.data) : [];
  const store = new ChromeStore();
  await store.clear();
  await store.saveHeader(header);
  await saveSyncSettings(settings);
  await startSession(await unwrapVaultKey(password, header));
  const vault = await openVault();
  if (!vault) throw new Error("Couldn't open the account's vault.");
  // Fetch the account's items first, so ones already there are skipped.
  await new SyncEngine({ vault, settings, saveSettings: saveSyncSettings, live: false }).syncNow();
  await mergeItemsInto(vault, items);
  await scheduleSync();
  await syncNow();
}
