import { DecryptionError, type Vault } from '@passvaultify/core';
import {
  Button,
  DataChip,
  Dialog,
  Fingerprint,
  Segmented,
  TextField,
  useToast,
} from '@passvaultify/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { DeleteVaultDialog } from './DeleteVaultDialog';
import { relativeTime, useRings } from './hooks';
import { StrengthReadout, useMasterStrength } from './MasterStrength';
import { promptInstall, useCanInstall } from './pwa';
import { AccentPicker, THEME_OPTIONS } from './Onboarding';
import {
  AUTO_LOCK_CHOICES,
  autoLockLabel,
  backupIsStale,
  defaultVaultName,
  type Profile,
} from './profile';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: Vault;
  profile: Profile;
  demo: boolean;
  onProfile: (profile: Profile) => void;
  onDeleteVault: () => Promise<void>;
  onExitDemo: () => void;
  onExportBackup: () => Promise<void>;
  onImport: () => void;
}

const AUTO_LOCK_OPTIONS = AUTO_LOCK_CHOICES.map((m) => ({
  value: String(m),
  label: m === 0 ? 'Never' : m === 60 ? '1 h' : `${m} min`,
}));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings__section">
      <h3 className="settings__title">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onOpenChange, vault, profile, demo, onProfile } = props;
  const [changeOpen, setChangeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rings = useRings(vault.header.fingerprint);
  const toast = useToast();
  const canInstall = useCanInstall();
  const set = (patch: Partial<Profile>) => onProfile({ ...profile, ...patch });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Settings" size="lg">
        <Section title="Profile">
          <div className="settings__grid">
            <TextField
              label="Your name"
              maxLength={40}
              value={profile.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <TextField
              label="Vault name"
              maxLength={40}
              value={profile.vaultName}
              onChange={(e) => set({ vaultName: e.target.value })}
              onBlur={() =>
                !profile.vaultName.trim() && set({ vaultName: defaultVaultName(profile.name) })
              }
            />
          </div>
        </Section>

        <Section title="Appearance">
          <div className="row-setting">
            <span className="row-setting__label">Theme</span>
            <Segmented
              label="Theme"
              value={profile.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => set({ theme })}
            />
          </div>
          <div className="row-setting">
            <span className="row-setting__label">Accent</span>
            <AccentPicker value={profile.accent} onChange={(accent) => set({ accent })} />
          </div>
        </Section>

        <Section title="Security">
          <div className="row-setting">
            <span className="row-setting__label">
              Lock after
              <span className="row-setting__hint">
                {profile.autoLockMinutes === 0
                  ? 'Only when you lock it'
                  : `${autoLockLabel(profile.autoLockMinutes)} without activity`}
              </span>
            </span>
            <Segmented
              label="Auto-lock"
              value={String(profile.autoLockMinutes)}
              options={AUTO_LOCK_OPTIONS}
              onChange={(m) => set({ autoLockMinutes: Number(m) })}
            />
          </div>
          <div className="row-setting">
            <span className="row-setting__label">
              Master password
              <span className="row-setting__hint">
                {vault.header.kdf.iterations.toLocaleString('en')} rounds of PBKDF2-SHA256
              </span>
            </span>
            <Button
              onClick={() => {
                onOpenChange(false);
                setChangeOpen(true);
              }}
            >
              Change…
            </Button>
          </div>
          <div className="fp-row">
            {rings && <Fingerprint bytes={rings} size={64} glyph="none" />}
            <div>
              <p className="pv-fp-code">{vault.header.fingerprint}</p>
              <p className="row-setting__hint">
                Your vault's fingerprint. The lock screen always shows it, so a fake one can't.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Storage and backups">
          <div className="row-setting">
            <DataChip mode={demo ? 'local' : profile.storageMode} />
          </div>
          <p className="row-setting__hint">
            {demo
              ? 'The demo vault is kept in memory only. Closing the tab erases it.'
              : "Encrypted in this browser's storage. Clearing this site's data in your browser erases the vault, so keep a backup somewhere else."}
          </p>
          <div className="row-setting">
            <span className="row-setting__label">
              Encrypted backup
              <span
                className="row-setting__hint"
                data-warn={(!demo && backupIsStale(profile.lastBackupAt)) || undefined}
              >
                {profile.lastBackupAt
                  ? `Last downloaded ${relativeTime(profile.lastBackupAt)}`
                  : 'Never downloaded. It opens with your master password, nothing else.'}
              </span>
            </span>
            <Button
              icon="download"
              onClick={() =>
                void props.onExportBackup().then(
                  () => toast('Backup downloaded'),
                  (err: unknown) => toast(`Couldn't create the backup: ${String(err)}`),
                )
              }
            >
              Download
            </Button>
          </div>
          <div className="row-setting">
            <span className="row-setting__label">
              Import
              <span className="row-setting__hint">
                From Chrome, Firefox, Bitwarden or 1Password, or merge a backup.
              </span>
            </span>
            <Button
              icon="upload"
              onClick={() => {
                onOpenChange(false);
                props.onImport();
              }}
            >
              Import…
            </Button>
          </div>
          {canInstall && (
            <div className="row-setting">
              <span className="row-setting__label">
                Install as an app
                <span className="row-setting__hint">
                  Its own window and icon, and it opens without a connection.
                </span>
              </span>
              <Button icon="download" onClick={() => void promptInstall()}>
                Install
              </Button>
            </div>
          )}
        </Section>

        <Section title={demo ? 'Demo' : 'Danger zone'}>
          {demo ? (
            <div className="row-setting">
              <span className="row-setting__label">
                Done exploring? Create a vault of your own.
              </span>
              <Button variant="primary" onClick={props.onExitDemo}>
                Leave the demo
              </Button>
            </div>
          ) : (
            <div className="row-setting">
              <span className="row-setting__label">
                Delete this vault
                <span className="row-setting__hint">Erases every item on this device.</span>
              </span>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  onOpenChange(false);
                  setDeleteOpen(true);
                }}
              >
                Delete vault…
              </Button>
            </div>
          )}
        </Section>
      </Dialog>

      <ChangePasswordDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        vault={vault}
        profile={profile}
      />
      <DeleteVaultDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        vaultName={profile.vaultName}
        onDelete={props.onDeleteVault}
      />
    </>
  );
}

function ChangePasswordDialog({
  open,
  onOpenChange,
  vault,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: Vault;
  profile: Profile;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change master password"
      description="Your items stay as they are: only the key that protects the vault key is re-encrypted."
    >
      <ChangePasswordForm vault={vault} profile={profile} onDone={() => onOpenChange(false)} />
    </Dialog>
  );
}

function ChangePasswordForm({
  vault,
  profile,
  onDone,
}: {
  vault: Vault;
  profile: Profile;
  onDone: () => void;
}) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { strength, current: fresh } = useMasterStrength(next, [
    profile.name,
    profile.vaultName,
    'passvaultify',
  ]);
  const ready =
    !!current && fresh && !!strength?.acceptable && next === confirm && next !== current && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await vault.changePassword(current, next);
      toast('Master password changed');
      onDone();
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof DecryptionError ? "That isn't your current master password." : String(err),
      );
    }
  };

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <TextField
        label="Current master password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextField
        label="New master password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        {...(next && next === current
          ? { hint: 'Pick something different from the current one' }
          : {})}
      />
      <StrengthReadout password={next} strength={strength} />
      <TextField
        label="Confirm new master password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        {...(confirm && confirm !== next ? { hint: "Doesn't match yet" } : {})}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!ready}>
          {busy ? 'Re-encrypting…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}
