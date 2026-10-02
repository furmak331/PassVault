import { Vault, type Fingerprint, type VaultHeader, type VaultStore } from '@passvaultify/core';
import { ToastProvider } from '@passvaultify/ui';
import { useCallback, useEffect, useState } from 'react';
import { IdbStore } from './db';
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
  deleteVault: () => Promise<void>;
  exitDemo: () => void;
}

export function App() {
  const [idb] = useState(() => new IdbStore());
  const [session, setSession] = useState<Session>({ store: idb, demo: false });
  const [profile, setProfile] = useState<Profile>(() => ({
    ...DEFAULT_PROFILE,
    theme: rememberedTheme(),
  }));
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const theme = useResolvedTheme(profile.theme);

  /** Read the vault on this device, if there is one. */
  const loadLocal = useCallback(
    () =>
      Promise.all([idb.loadHeader(), idb.loadProfile()]).then(([header, saved]) => {
        setSession({ store: idb, demo: false });
        setProfile(saved ?? { ...DEFAULT_PROFILE, theme: rememberedTheme() });
        setPhase(header ? { name: 'locked', header } : { name: 'onboarding' });
      }),
    [idb],
  );

  useEffect(() => {
    void loadLocal();
  }, [loadLocal]);

  // Keep the theme outside the vault too, so it applies before any vault exists.
  useEffect(() => rememberTheme(profile.theme), [profile.theme]);

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
    setPhase((p) => {
      if (p.name === 'unlocked') p.vault.lock();
      return { name: 'loading' };
    });
    await idb.clear();
    await loadLocal();
  }, [exitDemo, idb, loadLocal, session.demo]);

  const actions: AppActions = { lock, updateProfile, changeTheme, deleteVault, exitDemo };

  return (
    // Keyed by phase so toasts (and their Undo actions) never outlive a lock.
    <ToastProvider key={phase.name}>
      <div className="app" data-phase={phase.name}>
        {phase.name === 'loading' && <div className="app-loading" aria-busy="true" />}
        {phase.name === 'onboarding' && (
          <Onboarding
            profile={profile}
            onPreview={setProfile}
            onTheme={changeTheme}
            onCreate={createVault}
            onDemo={startDemo}
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
          <VaultApp vault={phase.vault} profile={profile} demo={session.demo} actions={actions} />
        )}
      </div>
    </ToastProvider>
  );
}
