import { DecryptionError, type VaultHeader } from '@passvaultify/core';
import { Button, DataChip, Dialog, Fingerprint, TextField } from '@passvaultify/ui';
import { useRef, useState, type FormEvent } from 'react';
import { DeleteVaultDialog } from './DeleteVaultDialog';
import { DEMO_PASSWORD } from './demo';
import { useRings } from './hooks';
import { Brand } from './Onboarding';
import type { Profile } from './profile';

export interface LockScreenProps {
  header: VaultHeader;
  profile: Profile;
  demo: boolean;
  onUnlock: (password: string) => Promise<void>;
  onDeleteVault: () => Promise<void>;
  onExitDemo: () => void;
}

function shake(el: HTMLElement | null) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate(
    [0, -8, 7, -5, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 360, easing: 'ease-out' },
  );
}

export function LockScreen({
  header,
  profile,
  demo,
  onUnlock,
  onDeleteVault,
  onExitDemo,
}: LockScreenProps) {
  const rings = useRings(header.fingerprint);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
    } catch (err) {
      setBusy(false);
      if (err instanceof DecryptionError) {
        setError(
          password.toLowerCase() === 'password'
            ? "That's the most common password in the world, so it isn't this one."
            : "That password didn't unlock this vault. Check Caps Lock and try again.",
        );
      } else {
        setError(`Couldn't unlock the vault: ${err instanceof Error ? err.message : String(err)}`);
      }
      shake(cardRef.current);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  };

  return (
    <main className="lock">
      <header className="lock__top">
        <Brand />
        <DataChip mode={demo ? 'local' : profile.storageMode} />
      </header>
      <div className="lock__card pv-card" ref={cardRef}>
        <div className="lock__fp" data-busy={busy || undefined}>
          {rings ? (
            <Fingerprint
              bytes={rings}
              size={176}
              turn={busy ? 180 : password.length * 9}
              label={`Vault fingerprint ${header.fingerprint}`}
            />
          ) : (
            <span className="lock__fp-placeholder" />
          )}
        </div>
        <div className="lock__id">
          <h1 className="lock__name">{profile.vaultName}</h1>
          <p className="pv-fp-code">{header.fingerprint}</p>
        </div>
        <form className="lock__form" onSubmit={(e) => void submit(e)}>
          <TextField
            ref={inputRef}
            label="Master password"
            hideLabel
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
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button variant="primary" size="lg" type="submit" disabled={!password || busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
        {demo ? (
          <div className="lock__demo">
            <span>
              Demo password: <code>{DEMO_PASSWORD}</code>
            </span>
            <div className="lock__links">
              <button type="button" className="link" onClick={() => setPassword(DEMO_PASSWORD)}>
                Fill it in
              </button>
              <button type="button" className="link" onClick={onExitDemo}>
                Leave the demo
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link lock__forgot" onClick={() => setForgotOpen(true)}>
            Forgot your master password?
          </button>
        )}
      </div>
      <p className="lock__hint">
        Check that the pattern and code match the ones you saw when you created this vault.
      </p>

      <Dialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        title="There's no reset link"
        description="Your vault is encrypted with a key that only your master password can produce. We never had it, so there's nothing to send you."
      >
        <ul className="plain-list">
          <li>Try variations you might have used: capitals, spaces, an extra word at the end.</li>
          <li>Check whether Caps Lock or a different keyboard layout is on.</li>
          <li>If you can't remember it, the only way forward is a new, empty vault.</li>
        </ul>
        <div className="dialog-actions">
          <Button
            variant="danger"
            onClick={() => {
              setForgotOpen(false);
              setDeleteOpen(true);
            }}
          >
            Start over with a new vault
          </Button>
          <Button variant="primary" onClick={() => setForgotOpen(false)}>
            Keep trying
          </Button>
        </div>
      </Dialog>
      <DeleteVaultDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        vaultName={profile.vaultName}
        intro="Starting over erases the locked vault from this device. Its items can't be recovered without the master password."
        onDelete={onDeleteVault}
      />
    </main>
  );
}
