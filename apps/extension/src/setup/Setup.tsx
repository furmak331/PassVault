import {
  BackupError,
  createBackup,
  DecryptionError,
  duplicateKey,
  estimateMasterPassword,
  formatDuration,
  openBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  unwrapVaultKey,
  Vault,
  type MasterPasswordStrength,
  type VaultBackup,
  type VaultHeader,
} from '@passvaultify/core';
import {
  Button,
  Dialog,
  Fingerprint,
  Icon,
  Meter,
  Segmented,
  Switch,
  TextField,
  ToastProvider,
  useToast,
} from '@passvaultify/ui';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { hasSiteAccess, SITE_ACCESS, syncCaptureScript } from '../shared/capture';
import { isUnlocked, lock, openVault, startSession, unlock } from '../shared/session';
import {
  ChromeStore,
  loadProfile,
  saveProfile,
  type Accent,
  type ExtensionProfile,
  type Theme,
} from '../shared/store';
import { loadSyncSettings } from '../shared/sync';
import { Brand, useBodyTheme, useRings } from '../shared/ui';
import { disconnect, SignInForm, SyncSection } from './Sync';

interface State {
  profile: ExtensionProfile;
  header: VaultHeader | null;
  unlocked: boolean;
  /** Whether Chrome lets the extension see websites (autofill and save prompts need it). */
  siteAccess: boolean;
}

async function readState(): Promise<State> {
  const [profile, header, unlocked, siteAccess] = await Promise.all([
    loadProfile(),
    new ChromeStore().loadHeader(),
    isUnlocked(),
    hasSiteAccess(),
  ]);
  return { profile, header, unlocked, siteAccess };
}

/** Reads overlap when storage changes in bursts; only the latest one counts. */
function useLatestState(): [State | null, () => void, (patch: Partial<ExtensionProfile>) => void] {
  const [state, setState] = useState<State | null>(null);
  const [refresh] = useState(() => {
    let latest = 0;
    return () => {
      const ticket = ++latest;
      void readState().then((next) => {
        if (ticket === latest) setState(next);
      });
    };
  });
  // Show a settings change at once; the storage write and re-read follow.
  const patchProfile = (patch: Partial<ExtensionProfile>) =>
    setState((current) => current && { ...current, profile: { ...current.profile, ...patch } });
  return [state, refresh, patchProfile];
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Setup() {
  const [state, refresh, patchProfile] = useLatestState();
  // Restoring writes the vault before its session starts; stay on the form until it's done.
  const [settingUp, setSettingUp] = useState(false);
  useEffect(() => {
    refresh();
    // Another window (the popup, another tab) may lock or change the vault.
    chrome.storage.onChanged.addListener(refresh);
    // Site access can also be granted from the popup, or removed in Chrome's settings.
    chrome.permissions.onAdded.addListener(refresh);
    chrome.permissions.onRemoved.addListener(refresh);
    return () => {
      chrome.storage.onChanged.removeListener(refresh);
      chrome.permissions.onAdded.removeListener(refresh);
      chrome.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);
  useBodyTheme(state?.profile ?? null);
  if (!state) return null;
  return (
    <ToastProvider>
      <main className="setup">
        <header className="setup__top">
          <Brand />
          <span className="pv-label">Chrome extension</span>
        </header>
        {state.header && !settingUp ? (
          <Settings state={state} refresh={refresh} patchProfile={patchProfile} />
        ) : (
          <Welcome
            onStart={() => setSettingUp(true)}
            onDone={() => {
              setSettingUp(false);
              refresh();
            }}
          />
        )}
      </main>
    </ToastProvider>
  );
}

/* ---------- First run ---------- */

interface SetupProps {
  onStart: () => void;
  onDone: () => void;
}

function Welcome({ onStart, onDone }: SetupProps) {
  return (
    <>
      <section className="setup__hero">
        <h1 className="pv-display setup__title">
          Set up PassVaultify in Chrome<span className="dot">.</span>
        </h1>
        <p className="setup__lede">
          The extension keeps its own copy of your vault, sealed in this browser. It fills logins
          only on the site they were saved for, and it can't see any page until you ask it to.
        </p>
      </section>
      <div className="setup__columns">
        <Panel
          step="Syncing already?"
          title="Sign in to your server"
          intro="If your vault lives on a PassVaultify sync server, sign in and it comes down here, still encrypted."
        >
          <SignInForm onStart={onStart} onDone={onDone} />
        </Panel>
        <Panel
          step="From a backup"
          title="Bring your vault from the web app"
          intro="In the PassVaultify web app, open Settings and choose Download under Encrypted backup. Then load that file here."
        >
          <RestoreForm onStart={onStart} onDone={onDone} />
          <ul className="facts">
            <li>Every login, note and tag comes across.</li>
            <li>Same master password, same fingerprint.</li>
            <li>The file stays sealed. Without the password it's noise.</li>
          </ul>
        </Panel>
        <Panel
          step="Or"
          title="Start a new vault here"
          intro="Your logins will live in this browser. You can download a backup and load it into the web app later."
        >
          <CreateForm onStart={onStart} onDone={onDone} />
        </Panel>
      </div>
    </>
  );
}

function Panel({
  step,
  title,
  intro,
  children,
}: {
  step: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <p className="pv-label">{step}</p>
      <h2 className="panel__title">{title}</h2>
      <p className="panel__intro">{intro}</p>
      {children}
    </section>
  );
}

function FilePicker({ onFile, label }: { onFile: (file: File) => void; label: string }) {
  const id = useId();
  return (
    <div className="picker">
      <label htmlFor={id} className="pv-btn pv-btn--ghost">
        <Icon name="upload" />
        {label}
      </label>
      <input
        id={id}
        className="pv-sr"
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function errorText(err: unknown): string {
  if (err instanceof DecryptionError) return "That password doesn't open this backup.";
  if (err instanceof BackupError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function RestoreForm({ onStart, onDone }: SetupProps) {
  const [backup, setBackup] = useState<{ file: string; data: VaultBackup } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async (e: FormEvent) => {
    e.preventDefault();
    if (!backup || !password || busy) return;
    setBusy(true);
    setError(null);
    onStart();
    try {
      // Every item is decrypted before anything is written.
      await openBackup(backup.data, password);
      await restoreBackup(new ChromeStore(), backup.data);
      await saveProfile({
        vaultName: backup.data.vaultName ?? 'My Vault',
        lastBackupAt: backup.data.exportedAt || null,
      });
      await startSession(await unwrapVaultKey(password, backup.data.header));
      onDone();
    } catch (err) {
      setBusy(false);
      setError(errorText(err));
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void restore(e)}>
      <FilePicker
        label={backup ? 'Choose a different file' : 'Choose backup file…'}
        onFile={(file) => {
          setError(null);
          void file
            .text()
            .then((text) => setBackup({ file: file.name, data: parseBackup(text) }))
            .catch((err: unknown) => setError(errorText(err)));
        }}
      />
      {backup && (
        <>
          <p className="picked">
            <strong>{backup.data.vaultName ?? backup.file}</strong>
            <span>
              {backup.data.records.length} items · fingerprint{' '}
              <span className="pv-fp-code">{backup.data.header.fingerprint}</span>
            </span>
          </p>
          <TextField
            label="Master password of this backup"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button variant="primary" type="submit" disabled={!password || busy}>
            {busy ? 'Decrypting…' : 'Restore vault'}
          </Button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

function CreateForm({ onStart, onDone }: SetupProps) {
  const [name, setName] = useState('My Vault');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [strength, setStrength] = useState<{ for: string; value: MasterPasswordStrength } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void estimateMasterPassword(password, [name, 'passvaultify']).then((value) => {
        if (!cancelled) setStrength({ for: password, value });
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, name]);

  const current = strength && strength.for === password ? strength.value : null;
  const ready = !!current?.acceptable && confirm === password && understood && !busy;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    onStart();
    const store = new ChromeStore();
    const { vault } = await Vault.create(store, password);
    await saveProfile({ vaultName: name.trim() || 'My Vault' });
    await startSession(await unwrapVaultKey(password, vault.header));
    onDone();
  };

  const score = password && current ? current.score : -1;
  return (
    <form className="stack" onSubmit={(e) => void create(e)}>
      <TextField label="Vault name" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField
        label="Master password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="strength">
        <Meter
          value={score + 1}
          tone={score >= 3 ? 'ok' : score === 2 ? 'warn' : 'danger'}
          label={`Strength: ${score >= 0 ? STRENGTH_LABELS[score] : 'not set'}`}
        />
        <span className="strength__time">
          {password && current
            ? `${STRENGTH_LABELS[current.score]} · offline guessing: ${formatDuration(current.crackSeconds)}`
            : 'At least 10 characters. A few random words work well.'}
        </span>
      </div>
      <TextField
        label="Type it again"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        {...(confirm && confirm !== password ? { hint: "Doesn't match yet" } : {})}
      />
      <Switch
        label="I understand it can't be recovered if I forget it"
        checked={understood}
        onChange={setUnderstood}
      />
      <Button variant="primary" type="submit" disabled={!ready}>
        {busy ? 'Sealing the vault…' : 'Create vault'}
      </Button>
    </form>
  );
}

/* ---------- Settings ---------- */

const AUTO_LOCK = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '60', label: '1 h' },
  { value: '0', label: 'Browser close' },
] as const;

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'porcelain', label: 'Porcelain' },
] as const;

const ACCENTS = [
  { value: 'signal', label: 'Signal' },
  { value: 'cobalt', label: 'Cobalt' },
  { value: 'jade', label: 'Jade' },
  { value: 'mono', label: 'Mono' },
] as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <span className="setting__label">
        {label}
        {hint && <span className="setting__hint">{hint}</span>}
      </span>
      <span className="setting__control">{children}</span>
    </div>
  );
}

function Settings({
  state,
  refresh,
  patchProfile,
}: {
  state: State;
  refresh: () => void;
  patchProfile: (patch: Partial<ExtensionProfile>) => void;
}) {
  const toast = useToast();
  const { profile, header } = state;
  const rings = useRings(header?.fingerprint);
  const [shortcuts, setShortcuts] = useState<chrome.commands.Command[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  useEffect(() => {
    void chrome.commands.getAll().then(setShortcuts);
  }, []);

  const set = async (patch: Partial<ExtensionProfile>) => {
    patchProfile(patch);
    await saveProfile(patch);
    refresh();
  };

  const turnOnAutofill = async () => {
    // Asked for at the moment it's switched on, from the click itself.
    if (!(await chrome.permissions.request(SITE_ACCESS))) {
      toast('Site access was not granted, so PassVaultify still can’t see any page.');
      return;
    }
    await saveProfile({ autofillMenu: true, offerToSave: true });
    await syncCaptureScript();
    refresh();
    toast('Autofill is on. Click into a sign-in field on any site to see it.');
  };

  const turnOffAutofill = async () => {
    await chrome.permissions.remove(SITE_ACCESS).catch(() => false);
    await syncCaptureScript();
    refresh();
    toast('Site access removed. PassVaultify can only touch a page when you click it.');
  };

  const setFeature = async (patch: Partial<ExtensionProfile>) => {
    await set(patch);
    await syncCaptureScript();
  };

  const download = async () => {
    const backup = await createBackup(new ChromeStore(), { vaultName: profile.vaultName });
    downloadText(
      `passvaultify-backup-${backup.exportedAt.slice(0, 10)}.json`,
      serializeBackup(backup),
    );
    await set({ lastBackupAt: backup.exportedAt });
    toast('Backup downloaded. Load it in the web app with Import.');
  };

  return (
    <div className="settings">
      <section className="vault-card">
        {rings && header && (
          <Fingerprint bytes={rings} size={96} bezel glyph={state.unlocked ? 'unlock' : 'lock'} />
        )}
        <div className="vault-card__id">
          <p className="pv-label">{state.unlocked ? 'Unlocked' : 'Locked'}</p>
          <h1 className="pv-display vault-card__name">{profile.vaultName}</h1>
          <p className="pv-fp-code">{header?.fingerprint}</p>
        </div>
        <div className="vault-card__action">
          {state.unlocked ? (
            <Button icon="lock" onClick={() => void lock().then(refresh)}>
              Lock
            </Button>
          ) : (
            <UnlockInline onDone={refresh} />
          )}
        </div>
      </section>

      {!state.siteAccess && <AutofillCard onTurnOn={() => void turnOnAutofill()} />}

      <Section title="Autofill on websites">
        <Row
          label="Site access"
          hint={
            state.siteAccess
              ? 'PassVaultify looks at login fields on the sites you visit, and nothing else on the page.'
              : 'Off: PassVaultify can only touch a page when you click it in the toolbar.'
          }
        >
          {state.siteAccess ? (
            <Button onClick={() => void turnOffAutofill()}>Turn off</Button>
          ) : (
            <Button variant="primary" onClick={() => void turnOnAutofill()}>
              Turn on
            </Button>
          )}
        </Row>
        {state.siteAccess && (
          <>
            <Row
              label="Suggest logins in sign-in fields"
              hint="A menu under the field with the logins saved for that site, and a strong password on sign-up forms."
            >
              <Switch
                label={profile.autofillMenu ? 'On' : 'Off'}
                checked={profile.autofillMenu}
                onChange={(on) => void setFeature({ autofillMenu: on })}
              />
            </Row>
            <Row
              label="Offer to save and update logins"
              hint="After you sign in or sign up, asks whether to save the login, or update the saved password if it changed."
            >
              <Switch
                label={profile.offerToSave ? 'On' : 'Off'}
                checked={profile.offerToSave}
                onChange={(on) => void setFeature({ offerToSave: on })}
              />
            </Row>
          </>
        )}
        {profile.neverSave.length > 0 && (
          <Row label="Never offer to save on" hint="Remove a site to be asked again there.">
            <span className="never-list">
              {profile.neverSave.map((site) => (
                <span key={site} className="never-chip">
                  {site}
                  <button
                    type="button"
                    aria-label={`Ask again on ${site}`}
                    title="Ask again"
                    onClick={() =>
                      void set({ neverSave: profile.neverSave.filter((s) => s !== site) })
                    }
                  >
                    <Icon name="close" />
                  </button>
                </span>
              ))}
            </span>
          </Row>
        )}
      </Section>

      <Section title="Security">
        <Row
          label="Lock after"
          hint="The key is also dropped when the computer locks or Chrome closes."
        >
          <Segmented
            label="Auto-lock"
            value={String(profile.autoLockMinutes)}
            options={AUTO_LOCK}
            onChange={(v) => void set({ autoLockMinutes: Number(v) })}
          />
        </Row>
        <Row label="Keyboard shortcuts" hint="Change them in Chrome's shortcut settings.">
          <span className="keys-inline">
            {shortcuts
              .filter((c) => c.shortcut)
              .map((c) => (
                <span key={c.name}>
                  <kbd className="pv-kbd">{c.shortcut}</kbd>{' '}
                  {c.name === '_execute_action' ? 'Open' : 'Fill'}
                </span>
              ))}
            <button
              type="button"
              className="link"
              onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
            >
              Change
            </button>
          </span>
        </Row>
      </Section>

      <Section title="Sync">
        <SyncSection unlocked={state.unlocked} />
      </Section>

      <Section title="Backups and the web app">
        <Row
          label="Download encrypted backup"
          hint={
            profile.lastBackupAt
              ? `Last downloaded ${new Date(profile.lastBackupAt).toLocaleDateString()}. Import it in the web app to bring logins saved here across.`
              : 'Import it in the web app to bring logins saved here across.'
          }
        >
          <Button icon="download" onClick={() => void download()}>
            Download
          </Button>
        </Row>
        <Row label="Merge a backup" hint="Add items from a web-app backup. Duplicates are skipped.">
          <Button icon="upload" disabled={!state.unlocked} onClick={() => setMergeOpen(true)}>
            {state.unlocked ? 'Merge…' : 'Unlock to merge'}
          </Button>
        </Row>
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={profile.theme}
            options={THEMES}
            onChange={(theme: Theme) => void set({ theme })}
          />
        </Row>
        <Row label="Signal color">
          <Segmented
            label="Accent"
            value={profile.accent}
            options={ACCENTS}
            onChange={(accent: Accent) => void set({ accent })}
          />
        </Row>
      </Section>

      <Section title="Remove">
        <Row
          label="Remove the vault from Chrome"
          hint="Erases the extension's copy. Your web-app vault and backups are not touched."
        >
          <Button variant="danger" icon="trash" onClick={() => setRemoveOpen(true)}>
            Remove…
          </Button>
        </Row>
      </Section>

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onMerged={(count) => {
          toast(count ? `${count} items added` : 'Nothing new: every item was already here');
          refresh();
        }}
      />
      <RemoveDialog open={removeOpen} onOpenChange={setRemoveOpen} onRemoved={refresh} />
    </div>
  );
}

/** The invitation to turn on in-page autofill, until it's on. */
function AutofillCard({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <section className="autofill-card">
      <span className="autofill-card__icon">
        <Icon name="key" />
      </span>
      <div className="autofill-card__text">
        <h2 className="autofill-card__title">Let PassVaultify help as you sign in</h2>
        <p>
          Click into a sign-in field and your logins for that site appear right under it. Sign-up
          forms get a strong password, and after you sign in PassVaultify offers to save the login,
          or update it if the password changed.
        </p>
        <p className="autofill-card__fine">
          Chrome will ask to let PassVaultify read and change data on websites. It looks only at
          login fields, fills only logins saved for that exact site, and you can turn it off here at
          any time.
        </p>
      </div>
      <Button variant="primary" size="lg" onClick={onTurnOn}>
        Turn on autofill
      </Button>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings__section">
      <h2 className="pv-label">{title}</h2>
      {children}
    </section>
  );
}

function UnlockInline({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <form
      className="unlock-inline"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        unlock(password).then(onDone, (err: unknown) => {
          setBusy(false);
          setError(err instanceof DecryptionError ? 'Wrong password' : String(err));
        });
      }}
    >
      <label htmlFor={id} className="pv-sr">
        Master password
      </label>
      <div className="combo">
        <input
          id={id}
          className="combo__input"
          type="password"
          placeholder="Master password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          className="combo__go"
          aria-label="Unlock"
          disabled={!password || busy}
        >
          {busy ? <span className="spinner" /> : <Icon name="arrow" />}
        </button>
      </div>
      {error && <span className="form-error">{error}</span>}
    </form>
  );
}

function MergeDialog({
  open,
  onOpenChange,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (count: number) => void;
}) {
  const [backup, setBackup] = useState<VaultBackup | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = (next: boolean) => {
    if (!next) {
      setBackup(null);
      setPassword('');
      setError(null);
      setBusy(false);
    }
    onOpenChange(next);
  };
  const merge = async (e: FormEvent) => {
    e.preventDefault();
    const vault = await openVault();
    if (!backup || !vault) return;
    setBusy(true);
    try {
      const items = await openBackup(backup, password);
      const seen = new Set(vault.list().map((i) => duplicateKey(i.data)));
      let added = 0;
      for (const { data } of items) {
        if (data.trashedAt || seen.has(duplicateKey(data))) continue;
        seen.add(duplicateKey(data));
        await vault.importItem(data);
        added++;
      }
      onMerged(added);
      close(false);
    } catch (err) {
      setBusy(false);
      setError(errorText(err));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Merge a backup"
      description="Items are re-sealed under this vault's key. Anything already here is skipped."
    >
      <form className="stack" onSubmit={(e) => void merge(e)}>
        <FilePicker
          label={backup ? 'Choose a different file' : 'Choose backup file…'}
          onFile={(file) =>
            void file
              .text()
              .then((text) => setBackup(parseBackup(text)))
              .catch((err: unknown) => setError(errorText(err)))
          }
        />
        {backup && (
          <TextField
            label="Master password of this backup"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!backup || !password || busy}>
            {busy ? 'Decrypting…' : 'Merge'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveDialog({
  open,
  onOpenChange,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}) {
  const [typed, setTyped] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
      title="Remove the vault from Chrome?"
      description="Logins saved only in the extension are erased unless you've downloaded a backup."
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim().toLowerCase() !== 'remove') return;
          void (async () => {
            await lock();
            const sync = await loadSyncSettings();
            if (sync) await disconnect(sync);
            await new ChromeStore().clear();
            onOpenChange(false);
            onRemoved();
          })();
        }}
      >
        <TextField
          label="Type “remove” to confirm"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="dialog-actions">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="danger"
            type="submit"
            icon="trash"
            disabled={typed.trim().toLowerCase() !== 'remove'}
          >
            Remove
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
