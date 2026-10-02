import { DecryptionError, type Vault, type VaultHeader } from '@passvaultify/core';
import { Button, DataChip, Dialog, Fingerprint, Icon } from '@passvaultify/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { DeleteVaultDialog } from './DeleteVaultDialog';
import { DEMO_PASSWORD } from './demo';
import { useRings } from './hooks';
import { Brand } from './Onboarding';
import type { Profile } from './profile';

export interface LockScreenProps {
  header: VaultHeader;
  profile: Profile;
  demo: boolean;
  /** Derive keys and decrypt. Rejects with DecryptionError on a wrong password. */
  unlock: (password: string) => Promise<Vault>;
  /** Called once the unlock animation has played. */
  onOpened: (vault: Vault) => void;
  onDeleteVault: () => Promise<void>;
  onExitDemo: () => void;
}

type State = 'idle' | 'working' | 'wrong' | 'open';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function wobble(el: Element | null) {
  if (!el || reducedMotion()) return;
  el.animate(
    [0, -7, 6, -4, 2, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
    { duration: 420, easing: 'ease-out' },
  );
}

export function LockScreen({
  header,
  profile,
  demo,
  unlock,
  onOpened,
  onDeleteVault,
  onExitDemo,
}: LockScreenProps) {
  const rings = useRings(header.fingerprint);
  const inputId = useId();
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dialRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // While keys are derived (a deliberately slow step), the bezel fills like a gauge.
  useEffect(() => {
    if (state !== 'working') return;
    const timer = setInterval(() => setProgress((p) => Math.min(0.9, p + 0.025)), 30);
    return () => clearInterval(timer);
  }, [state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || state === 'working' || state === 'open') return;
    setState('working');
    setProgress(0);
    setError(null);
    try {
      const vault = await unlock(password);
      setProgress(1);
      setState('open');
      setTimeout(() => onOpened(vault), reducedMotion() ? 0 : 720);
    } catch (err) {
      setState('wrong');
      setProgress(0);
      if (err instanceof DecryptionError) {
        setError(
          password.toLowerCase() === 'password'
            ? "That's the most common password in the world, so it isn't this one."
            : "That didn't open this vault. Check Caps Lock and try again.",
        );
      } else {
        setError(`Couldn't unlock the vault: ${err instanceof Error ? err.message : String(err)}`);
      }
      wobble(dialRef.current);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  };

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState('CapsLock'));

  const turn = state === 'open' ? 360 : state === 'working' ? 120 : password.length * 9;

  return (
    <main className="lock" data-state={state}>
      <header className="lock__bar">
        <Brand />
        <DataChip mode={demo ? 'local' : profile.storageMode} />
      </header>

      <div className="lock__stage">
        <div className="lock__dial" ref={dialRef}>
          {rings ? (
            <Fingerprint
              bytes={rings}
              size={340}
              bezel
              lit={progress}
              turn={turn}
              glyph={state === 'open' ? 'unlock' : 'lock'}
              label={`Vault fingerprint ${header.fingerprint}`}
            />
          ) : (
            <span className="lock__dial-placeholder" />
          )}
        </div>

        <div className="lock__panel">
          <p className="pv-label">{state === 'open' ? 'Opening' : 'Locked'}</p>
          <h1 className="pv-display lock__name">{profile.vaultName}</h1>
          <p className="lock__code">
            <span className="pv-label">Fingerprint</span>
            <span className="pv-fp-code">{header.fingerprint}</span>
          </p>

          <form className="combo" onSubmit={(e) => void submit(e)}>
            <label htmlFor={inputId} className="pv-sr">
              Master password
            </label>
            <input
              id={inputId}
              ref={inputRef}
              className="combo__input"
              type="password"
              placeholder="Master password"
              autoComplete="current-password"
              autoFocus
              spellCheck={false}
              value={password}
              readOnly={state === 'working' || state === 'open'}
              aria-invalid={state === 'wrong' || undefined}
              aria-describedby={error ? `${inputId}-error` : undefined}
              onKeyDown={checkCaps}
              onKeyUp={checkCaps}
              onChange={(e) => {
                setPassword(e.target.value);
                if (state === 'wrong') setState('idle');
                setError(null);
              }}
            />
            <button
              type="submit"
              className="combo__go"
              aria-label="Unlock"
              disabled={!password || state === 'working' || state === 'open'}
            >
              {state === 'working' ? <span className="spinner" /> : <Icon name="arrow" />}
            </button>
          </form>
          <div className="lock__messages">
            {capsLock && <span className="pv-field__warn">Caps Lock is on</span>}
            {error && (
              <p id={`${inputId}-error`} className="lock__error" role="alert">
                {error}
              </p>
            )}
          </div>

          {demo ? (
            <div className="lock__demo">
              <span className="pv-label">Demo vault</span>
              <span>
                The password is <code>{DEMO_PASSWORD}</code>
              </span>
              <span className="lock__links">
                <button type="button" className="link" onClick={() => setPassword(DEMO_PASSWORD)}>
                  Fill it in
                </button>
                <button type="button" className="link" onClick={onExitDemo}>
                  Leave the demo
                </button>
              </span>
            </div>
          ) : (
            <button type="button" className="link lock__forgot" onClick={() => setForgotOpen(true)}>
              Forgot your master password?
            </button>
          )}
        </div>
      </div>

      <footer className="lock__foot">
        Only type your master password when this dial and code match the ones you saw when the vault
        was created.
      </footer>

      <Dialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        title="There's no reset link"
        description="Your vault is encrypted with a key that only your master password can produce. We never had it, so there's nothing to send you."
      >
        <ul className="plain-list">
          <li>Try the variations you tend to use: capitals, spaces, an extra word at the end.</li>
          <li>Check whether Caps Lock or a different keyboard layout is on.</li>
          <li>If it's truly gone, the only way forward is a new, empty vault.</li>
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
