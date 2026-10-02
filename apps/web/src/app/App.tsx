import {
  changePassword,
  createBackup,
  mergeItemsInto,
  openBackup,
  restoreBackup,
  serializeBackup,
  SyncEngine,
  toBase64Url,
  Vault,
  type Fingerprint,
  type SyncConflict,
  type SyncSettings,
  type SyncStatus,
  type VaultBackup,
  type VaultHeader,
  type VaultStore,
} from '@passvaultify/core';
import { ToastProvider, useToast } from '@passvaultify/ui';
import { useCallback, useEffect, useState } from 'react';
import { IdbStore } from './db';
import { backupFilename, downloadText } from './files';
import { createDemoVault, DEMO_PROFILE } from './demo';
import { useIdleLock, useResolvedTheme } from './hooks';
import { LockScreen } from './LockScreen';
import { Onboarding } from './Onboarding';
import {
  DEFAULT_PROFILE,
  rememberedTheme,
  rememberTheme,
  type Profile,
  type ThemeSetting,
} from './profile';
import { applyUpdate, useUpdateReady } from './pwa';
import { useSyncEngine } from './sync';
import type { SyncActions } from './SyncDialog';
import { VaultApp } from './VaultApp';

type Phase =
  | { name: 'loading' }
  | { name: 'onboarding' }
  | { name: 'locked'; header: VaultHeader }
  | { name: 'unlocked'; vault: Vault };

interface Session {
  store: VaultStore;
  /** The demo vault lives in memory and never touches IndexedDB. */
  demo: boolean;
}

export interface AppActions {
  lock: () => void;
  updateProfile: (profile: Profile) => void;
  changeTheme: (theme: ThemeSetting) => void;
  /** Download an encrypted backup of the vault on this device. */
  exportBackup: () => Promise<void>;
  deleteVault: () => Promise<void>;
  exitDemo: () => void;
  /** Re-wraps the vault key; on a synced vault, through the server first. */
  changePassword: (current: string, next: string) => Promise<void>;
}

/** Everything the vault screens need to show and drive sync. */
export interface SyncHandle {
  connection: SyncSettings | null;
  engine: SyncEngine | null;
  status: SyncStatus | null;
  actions: SyncActions;
}

export function App() {
  const [idb] = useState(() => new IdbStore());
  const [session, setSession] = useState<Session>({ store: idb, demo: false });
  const [profile, setProfile] = useState<Profile>(() => ({
    ...DEFAULT_PROFILE,
    theme: rememberedTheme(),
  }));
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [connection, setConnection] = useState<SyncSettings | null>(null);
  const [conflicts, setConflicts] = useState<{ list: SyncConflict[]; at: number } | null>(null);
  /** Bumped when the open vault is swapped for another, so its screens start fresh. */
  const [epoch, setEpoch] = useState(0);
  const theme = useResolvedTheme(profile.theme);
  const synced = phase.name === 'unlocked' && !session.demo ? phase.vault : null;
  const { engine, status } = useSyncEngine(synced, connection, idb, (list) =>
    setConflicts({ list, at: Date.now() }),
  );

  /** Read the vault on this device, if there is one. */
  const loadLocal = useCallback(
    () =>
      Promise.all([idb.loadHeader(), idb.loadProfile(), idb.loadSync()]).then(
        ([header, saved, sync]) => {
          setSession({ store: idb, demo: false });
          setProfile(saved ?? { ...DEFAULT_PROFILE, theme: rememberedTheme() });
          setConnection(sync);
          setPhase(header ? { name: 'locked', header } : { name: 'onboarding' });
        },
      ),
    [idb],
  );

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  // Keep the theme outside the vault too, so it applies before any vault exists.
  useEffect(() => rememberTheme(profile.theme), [profile.theme]);

  // The browser's own chrome (mobile address bar, installed app title bar) matches.
  useEffect(() => {
    const color = theme === 'porcelain' ? '#f1eee6' : '#0e0e0c';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  }, [theme]);

  // Dialogs and toasts render in portals on <body>, so the theme lives there too.
  useEffect(() => {
    const body = document.body;
    body.classList.add('pv-root');
    body.dataset.theme = theme;
    body.dataset.accent = profile.accent;
  }, [theme, profile.accent]);

  useEffect(() => {
    const where =
      phase.name === 'unlocked' ? profile.vaultName : phase.name === 'locked' ? 'Locked' : '';
    document.title = where ? `${where} · PassVaultify` : 'PassVaultify';
  }, [phase.name, profile.vaultName]);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.name !== 'unlocked') return p;
      p.vault.lock();
      return { name: 'locked', header: p.vault.header };
    });
  }, []);

  useIdleLock(phase.name === 'unlocked', profile.autoLockMinutes, lock);

  const updateProfile = useCallback(
    (next: Profile) => {
      setProfile(next);
      if (!session.demo) void idb.saveProfile(next);
    },
    [idb, session.demo],
  );

  /** The quick theme switch: saved with the profile once a vault exists. */
  const changeTheme = (theme: ThemeSetting) => {
    if (phase.name === 'onboarding') setProfile({ ...profile, theme });
    else updateProfile({ ...profile, theme });
  };

  const createVault = async (
    draft: Profile,
    password: string,
  ): Promise<{ vault: Vault; fingerprint: Fingerprint }> => {
    const created = await Vault.create(idb, password);
    await idb.saveProfile(draft);
    setProfile(draft);
    return created;
  };

  const exportBackup = async () => {
    const backup = await createBackup(session.store, { vaultName: profile.vaultName });
    downloadText(backupFilename(), serializeBackup(backup));
    if (!session.demo) updateProfile({ ...profile, lastBackupAt: backup.exportedAt });
  };

  /** Welcome screen: bring a vault back from a backup file, then open it. */
  const restoreVault = async (backup: VaultBackup, password: string) => {
    // Proves the password and every item before anything is written.
    await openBackup(backup, password);
    await restoreBackup(idb, backup);
    const vault = await Vault.unlock(idb, password);
    const next: Profile = {
      ...profile,
      vaultName: backup.vaultName ?? profile.vaultName,
      lastBackupAt: backup.exportedAt || null,
    };
    await idb.saveProfile(next);
    setProfile(next);
    setPhase({ name: 'unlocked', vault });
  };

  const startDemo = async () => {
    const { vault, store } = await createDemoVault();
    setSession({ store, demo: true });
    // The demo brings its own name, but keeps the look the visitor already chose.
    setProfile({ ...DEMO_PROFILE, theme: profile.theme, accent: profile.accent });
    setPhase({ name: 'unlocked', vault });
  };

  const exitDemo = useCallback(() => {
    setPhase((p) => {
      if (p.name === 'unlocked') p.vault.lock();
      return { name: 'loading' };
    });
    void loadLocal();
  }, [loadLocal]);

  const deleteVault = useCallback(async () => {
    if (session.demo) {
      exitDemo();
      return;
    }
    // Sign this device out of the server, if it can. The server keeps the account.
    await engine?.client?.logout().catch(() => undefined);
    setPhase((p) => {
      if (p.name === 'unlocked') p.vault.lock();
      return { name: 'loading' };
    });
    await idb.clear();
    await loadLocal();
  }, [engine, exitDemo, idb, loadLocal, session.demo]);

  const changeMasterPassword = async (current: string, next: string) => {
    if (phase.name !== 'unlocked') return;
    const vault = phase.vault;
    if (!engine?.client) {
      await vault.changePassword(current, next);
      return;
    }
    // The server must take the new auth key first, or this device couldn't sign in again.
    const changed = await changePassword(current, next, vault.header);
    await engine.client.changeMasterPassword(
      current,
      vault.header.kdf,
      toBase64Url(changed.authKey),
      changed.header,
    );
    await vault.applyPasswordChange(changed);
  };

  const withStorage = async (storageMode: Profile['storageMode']) => {
    const next = { ...profile, storageMode };
    await idb.saveProfile(next);
    setProfile(next);
    return next;
  };

  const syncActions: SyncActions = {
    connected: async (settings) => {
      await idb.saveSync(settings);
      await withStorage('self');
      setConnection(settings);
    },
    joinVault: async (settings, header, password) => {
      if (phase.name !== 'unlocked') return;
      const items = [...phase.vault.list(), ...phase.vault.trash()].map((i) => i.data);
      phase.vault.lock();
      await idb.clear();
      await idb.saveHeader(header);
      await idb.saveSync(settings);
      await withStorage('self');
      const vault = await Vault.unlock(idb, password);
      // Fetch the account's items first, so ones this device already had are skipped.
      await new SyncEngine({
        vault,
        settings,
        saveSettings: (s) => idb.saveSync(s),
        live: false,
      }).syncNow();
      await mergeItemsInto(vault, items);
      setConnection(settings);
      setEpoch((e) => e + 1);
      setPhase({ name: 'unlocked', vault });
    },
    disconnect: async () => {
      await engine?.client?.logout().catch(() => undefined);
      await idb.saveSync(null);
      await withStorage('local');
      setConnection(null);
    },
  };

  /** Welcome screen on a new device: sign in and take the account's vault. */
  const signInNewDevice = async (settings: SyncSettings, header: VaultHeader, password: string) => {
    await idb.clear();
    await idb.saveHeader(header);
    await idb.saveSync(settings);
    await withStorage('self');
    const vault = await Vault.unlock(idb, password);
    setConnection(settings);
    setPhase({ name: 'unlocked', vault });
  };

  const actions: AppActions = {
    lock,
    updateProfile,
    changeTheme,
    exportBackup,
    deleteVault,
    exitDemo,
    changePassword: changeMasterPassword,
  };
  const sync: SyncHandle = { connection, engine, status, actions: syncActions };

  return (
    // Keyed by phase so toasts (and their Undo actions) never outlive a lock.
    <ToastProvider key={phase.name}>
      <UpdateNotice />
      <ConflictNotice conflicts={conflicts} />
      <div className="app" data-phase={phase.name}>
        {phase.name === 'loading' && <div className="app-loading" aria-busy="true" />}
        {phase.name === 'onboarding' && (
          <Onboarding
            profile={profile}
            onPreview={setProfile}
            onTheme={changeTheme}
            onRestore={restoreVault}
            onCreate={createVault}
            onDemo={startDemo}
            onSignIn={signInNewDevice}
            onDone={(vault) => setPhase({ name: 'unlocked', vault })}
          />
        )}
        {phase.name === 'locked' && (
          <LockScreen
            header={phase.header}
            profile={profile}
            demo={session.demo}
            unlock={(password) => Vault.unlock(session.store, password)}
            onOpened={(vault) => setPhase({ name: 'unlocked', vault })}
            onDeleteVault={deleteVault}
            onExitDemo={exitDemo}
            onTheme={changeTheme}
          />
        )}
        {phase.name === 'unlocked' && (
          <VaultApp
            key={epoch}
            vault={phase.vault}
            profile={profile}
            demo={session.demo}
            actions={actions}
            sync={sync}
          />
        )}
      </div>
    </ToastProvider>
  );
}

/** Says when sync kept two versions of an item, so nothing was silently overwritten. */
function ConflictNotice({ conflicts }: { conflicts: { list: SyncConflict[]; at: number } | null }) {
  const toast = useToast();
  useEffect(() => {
    if (!conflicts?.list.length) return;
    const [first] = conflicts.list;
    toast(
      conflicts.list.length === 1 && first
        ? `"${first.title}" changed on two devices. Both versions are kept; the other is marked (conflict).`
        : `${conflicts.list.length} items changed on two devices. Both versions of each are kept, marked (conflict).`,
      { duration: 10_000 },
    );
  }, [conflicts, toast]);
  return null;
}

/** Offers a new version once its files are cached, instead of reloading on its own. */
function UpdateNotice() {
  const ready = useUpdateReady();
  const toast = useToast();
  useEffect(() => {
    if (ready) {
      toast('A new version of PassVaultify is ready', {
        action: { label: 'Reload', onClick: applyUpdate },
        duration: 60_000,
      });
    }
  }, [ready, toast]);
  return null;
}
