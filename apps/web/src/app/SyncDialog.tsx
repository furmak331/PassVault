import {
  checkServer,
  compareVaults,
  createSyncAccount,
  signInToSync,
  SyncError,
  unlockVault,
  type ServerInfo,
  type SyncDevice,
  type SyncEngine,
  type SyncSettings,
  type SyncStatus,
  type Vault,
  type VaultHeader,
} from '@passvaultify/core';
import {
  Badge,
  Button,
  Dialog,
  Fingerprint,
  Icon,
  Segmented,
  TextField,
  useToast,
} from '@passvaultify/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { relativeTime, useRings } from './hooks';
import { deviceName, hostOf, syncSentence } from './sync';

export interface SyncActions {
  /** Connected with this vault (a new account, or the same vault on the account). */
  connected: (settings: SyncSettings) => Promise<void>;
  /** The account holds a different vault: switch to it, bringing this device's items. */
  joinVault: (settings: SyncSettings, header: VaultHeader, password: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

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

export function SyncDialog({
  open,
  onOpenChange,
  vault,
  connection,
  engine,
  status,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: Vault;
  connection: SyncSettings | null;
  engine: SyncEngine | null;
  status: SyncStatus | null;
  actions: SyncActions;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={connection ? 'Sync' : 'Connect a sync server'}
      {...(connection
        ? {}
        : {
            description:
              'Your vault is encrypted here before anything is sent. The server stores ciphertext it has no key for.',
          })}
    >
      {connection ? (
        <Connected
          connection={connection}
          engine={engine}
          status={status}
          vault={vault}
          onDisconnect={async () => {
            await actions.disconnect();
            onOpenChange(false);
          }}
        />
      ) : (
        <ConnectFlow
          vault={vault}
          onDone={() => onOpenChange(false)}
          onConnected={actions.connected}
          onJoin={actions.joinVault}
        />
      )}
    </Dialog>
  );
}

// ---------- Connecting ----------

type Stage =
  | { name: 'server' }
  | { name: 'account'; server: string; info: ServerInfo }
  | {
      name: 'different';
      settings: SyncSettings;
      header: VaultHeader;
      password: string;
    };

/** For a device that already has a vault: create an account from it, or sign in. */
function ConnectFlow({
  vault,
  onDone,
  onConnected,
  onJoin,
}: {
  vault: Vault;
  onDone: () => void;
  onConnected: SyncActions['connected'];
  onJoin: SyncActions['joinVault'];
}) {
  const [stage, setStage] = useState<Stage>({ name: 'server' });
  const toast = useToast();

  if (stage.name === 'server') {
    return <ServerStep onChecked={(server, info) => setStage({ name: 'account', server, info })} />;
  }
  if (stage.name === 'different') {
    return (
      <DifferentVault
        localCount={vault.list().length + vault.trash().length}
        remoteFingerprint={stage.header.fingerprint}
        onJoin={async () => {
          await onJoin(stage.settings, stage.header, stage.password);
          toast('Joined the vault on your server');
          onDone();
        }}
        onCancel={onDone}
      />
    );
  }
  return (
    <AccountStep
      server={stage.server}
      info={stage.info}
      allowCreate
      onBack={() => setStage({ name: 'server' })}
      onSubmit={async (mode, email, password) => {
        const options = {
          server: stage.server,
          serverFingerprint: stage.info.fingerprint,
          email,
          password,
          device: { name: deviceName(), kind: 'web' as const },
        };
        if (mode === 'create') {
          const settings = await createSyncAccount(vault, options);
          await onConnected(settings);
          const count = vault.list().length + vault.trash().length;
          toast(`Connected. Uploading ${count} ${count === 1 ? 'item' : 'items'}`);
          onDone();
          return;
        }
        const { settings, header } = await signInToSync(options);
        if (compareVaults(vault.header, header) === 'different') {
          setStage({ name: 'different', settings, header, password });
          return;
        }
        // The same vault (restored from a backup, say). If its password was changed
        // since, the account's header wins: it opens with the password just typed.
        if (header.wrappedVaultKey !== vault.header.wrappedVaultKey) {
          await unlockVault(password, header);
          await vault.adoptHeader(header);
        }
        await vault.resetSync();
        await onConnected(settings);
        toast('Connected. Merging with your server');
        onDone();
      }}
    />
  );
}

/** Step 1: where is the server? Used by the welcome screen too. */
export function ServerStep({
  onChecked,
}: {
  onChecked: (server: string, info: ServerInfo) => void;
}) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { server, info } = await checkServer(address);
      onChecked(server, info);
    } catch (err) {
      setBusy(false);
      setError(syncErrorText(err));
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <TextField
        label="Server address"
        placeholder="vault.example.com"
        autoComplete="url"
        inputMode="url"
        spellCheck={false}
        autoFocus
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        hint="A PassVaultify server you or someone you trust runs. It needs HTTPS."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="primary" type="submit" icon="server" disabled={!address.trim() || busy}>
          {busy ? 'Checking…' : 'Check server'}
        </Button>
      </div>
    </form>
  );
}

/** The server's fingerprint, drawn like a vault's, to compare with what the server shows. */
export function ServerIdentity({ server, info }: { server: string; info: ServerInfo }) {
  const rings = useRings(info.fingerprint);
  return (
    <div className="server-id">
      {rings && <Fingerprint bytes={rings} size={72} glyph="none" />}
      <div className="server-id__text">
        <span className="server-id__host">{hostOf(server)}</span>
        <span className="pv-fp-code">{info.fingerprint}</span>
        <span className="row-setting__hint">
          Server fingerprint. Check it matches the one at {hostOf(server)}/v1/server before you sign
          in. If it doesn't, stop here.
        </span>
      </div>
    </div>
  );
}

type AccountMode = 'create' | 'signin';

/** Step 2: create an account, or sign in to one. */
export function AccountStep({
  server,
  info,
  allowCreate,
  onBack,
  onSubmit,
}: {
  server: string;
  info: ServerInfo;
  allowCreate: boolean;
  onBack: () => void;
  onSubmit: (mode: AccountMode, email: string, password: string) => Promise<void>;
}) {
  const canCreate = allowCreate && info.registration === 'open';
  const [mode, setMode] = useState<AccountMode>(canCreate ? 'create' : 'signin');
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
      <ServerIdentity server={server} info={info} />
      {allowCreate && (
        <Segmented
          label="Account"
          value={mode}
          options={[
            { value: 'create', label: 'Create an account', disabled: !canCreate },
            { value: 'signin', label: 'Sign in' },
          ]}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
        />
      )}
      {allowCreate && !canCreate && (
        <p className="row-setting__hint">This server isn't taking new accounts.</p>
      )}
      <TextField
        label="Email"
        type="email"
        autoComplete="username"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Master password"
        type="password"
        autoComplete={mode === 'create' ? 'current-password' : 'current-password'}
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
      <div className="dialog-actions">
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" type="submit" disabled={!email || !password || busy}>
          {busy
            ? mode === 'create'
              ? 'Creating…'
              : 'Signing in…'
            : mode === 'create'
              ? 'Create account'
              : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}

function DifferentVault({
  localCount,
  remoteFingerprint,
  onJoin,
  onCancel,
}: {
  localCount: number;
  remoteFingerprint: string;
  onJoin: () => Promise<void>;
  onCancel: () => void;
}) {
  const rings = useRings(remoteFingerprint);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="server-id">
        {rings && <Fingerprint bytes={rings} size={72} glyph="none" />}
        <div className="server-id__text">
          <span className="server-id__host">The account's vault</span>
          <span className="pv-fp-code">{remoteFingerprint}</span>
        </div>
      </div>
      <p>
        That account already has a vault, and it isn't this one. You can switch this device to it:
        the {localCount} {localCount === 1 ? 'item' : 'items'} here will be added to it, skipping
        ones it already has. After that, this device opens with the account's master password.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onJoin().catch((err: unknown) => {
              setBusy(false);
              setError(syncErrorText(err));
            });
          }}
        >
          {busy ? 'Switching…' : 'Switch to that vault'}
        </Button>
      </div>
    </div>
  );
}

// ---------- Connected ----------

function Connected({
  connection,
  engine,
  status,
  vault,
  onDisconnect,
}: {
  connection: SyncSettings;
  engine: SyncEngine | null;
  status: SyncStatus | null;
  vault: Vault;
  onDisconnect: () => Promise<void>;
}) {
  const rings = useRings(connection.serverFingerprint);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="stack sync-panel">
      <div className="server-id">
        {rings && <Fingerprint bytes={rings} size={56} glyph="none" />}
        <div className="server-id__text">
          <span className="server-id__host">{hostOf(connection.server)}</span>
          <span className="row-setting__hint">Signed in as {connection.email}</span>
          <span className="pv-fp-code">{connection.serverFingerprint}</span>
        </div>
      </div>

      <div className="sync-state" data-state={status?.state ?? 'idle'}>
        <span className="sync-state__lamp" aria-hidden="true" />
        <p>{syncSentence(status)}</p>
        {status?.state !== 'signed-out' && (
          <Button
            icon="refresh"
            disabled={!engine || status?.state === 'syncing'}
            onClick={() => void engine?.syncNow()}
          >
            Sync now
          </Button>
        )}
      </div>

      {status?.state === 'signed-out' && engine && <SignInAgain engine={engine} />}

      {engine?.client && status?.state !== 'signed-out' && <Devices engine={engine} />}

      {engine?.client && status?.state !== 'signed-out' && (
        <DeleteAccount engine={engine} vault={vault} onDeleted={onDisconnect} />
      )}

      <div className="row-setting">
        <span className="row-setting__label">
          Stop syncing on this device
          <span className="row-setting__hint">
            The vault stays here, as a local-only vault. The server keeps its copy.
          </span>
        </span>
        {confirming ? (
          <span className="inline-actions">
            <Button onClick={() => setConfirming(false)}>Keep</Button>
            <Button variant="danger" onClick={() => void onDisconnect()}>
              Disconnect
            </Button>
          </span>
        ) : (
          <Button onClick={() => setConfirming(true)}>Disconnect…</Button>
        )}
      </div>
    </div>
  );
}

function SignInAgain({ engine }: { engine: SyncEngine }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError(null);
        engine.signIn(password, { name: deviceName(), kind: 'web' }).then(
          () => toast('Signed in. Syncing again'),
          (err: unknown) => {
            setBusy(false);
            setError(syncErrorText(err));
          },
        );
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
      <div className="dialog-actions">
        <Button variant="primary" type="submit" disabled={!password || busy}>
          {busy ? 'Signing in…' : 'Sign in again'}
        </Button>
      </div>
    </form>
  );
}

function Devices({ engine }: { engine: SyncEngine }) {
  const [devices, setDevices] = useState<SyncDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    engine.client?.devices().then(
      (list) => !cancelled && setDevices(list),
      (err: unknown) => !cancelled && setError(syncErrorText(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [engine, version]);

  return (
    <section className="devices" aria-label="Signed-in devices">
      <h4 className="pv-label">Signed-in devices</h4>
      {error && <p className="row-setting__hint">{error}</p>}
      {!devices && !error && <p className="row-setting__hint">Loading…</p>}
      <ul>
        {devices?.map((device) => (
          <li key={device.id} className="device">
            <Icon name={device.kind === 'extension' ? 'shield' : 'device'} />
            <span className="device__text">
              <span className="device__name">{device.name}</span>
              <span className="row-setting__hint">
                {device.kind === 'extension' ? 'Extension' : device.kind === 'cli' ? 'CLI' : 'Web'}{' '}
                · active {relativeTime(device.lastSeenAt)}
              </span>
            </span>
            {device.current ? (
              <Badge>This device</Badge>
            ) : (
              <Button
                onClick={() =>
                  void engine.client?.signOutDevice(device.id).then(
                    () => {
                      toast(`Signed out ${device.name}`);
                      setVersion((v) => v + 1);
                    },
                    (err: unknown) => toast(syncErrorText(err)),
                  )
                }
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Delete the account on the server, with every device and item there. This device keeps its vault. */
function DeleteAccount({
  engine,
  vault,
  onDeleted,
}: {
  engine: SyncEngine;
  vault: Vault;
  onDeleted: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  if (!open) {
    return (
      <div className="row-setting">
        <span className="row-setting__label">
          Delete the account on the server
          <span className="row-setting__hint">
            Erases the server's copy and signs every device out. The vault here stays.
          </span>
        </span>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account…
        </Button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || busy) return;
        setBusy(true);
        setError(null);
        engine.client
          ?.deleteAccount(password, vault.header.kdf)
          .then(async () => {
            await onDeleted();
            toast("Account deleted. This device's vault is now local only");
          })
          .catch((err: unknown) => {
            setBusy(false);
            setError(syncErrorText(err));
          });
      }}
    >
      <TextField
        label="Master password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="Other devices keep whatever copy they have, as local vaults."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="danger" type="submit" disabled={!password || busy}>
          {busy ? 'Deleting…' : 'Delete account'}
        </Button>
      </div>
    </form>
  );
}
