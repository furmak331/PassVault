import {
  DEFAULT_ITERATIONS,
  generatePassphrase,
  signInToSync,
  type Fingerprint as VaultFingerprint,
  type ServerInfo,
  type SyncSettings,
  type Vault,
  type VaultBackup,
  type VaultHeader,
} from '@passvaultify/core';
import { Badge, Button, Dialog, Fingerprint, Icon, TextField } from '@passvaultify/ui';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRings } from './hooks';
import { RestoreDialog } from './ImportDialog';
import { deviceName } from './sync';
import { AccountStep, ServerStep } from './SyncDialog';
import { ThemeToggle } from './ThemeToggle';
import { StrengthReadout, useMasterStrength } from './MasterStrength';
import {
  ACCENTS,
  defaultVaultName,
  type Accent,
  type Profile,
  type StorageMode,
  type ThemeSetting,
} from './profile';

type Step = 'welcome' | 'you' | 'storage' | 'look' | 'master' | 'sealed';
const NUMBERED: Step[] = ['you', 'storage', 'look', 'master'];

export const THEME_OPTIONS: { value: ThemeSetting; label: string; note: string }[] = [
  { value: 'system', label: 'System', note: 'Follows your device' },
  { value: 'graphite', label: 'Graphite', note: 'For low light' },
  { value: 'porcelain', label: 'Porcelain', note: 'For daylight' },
];

export interface OnboardingProps {
  profile: Profile;
  /** Called as choices change, so the whole page previews them. */
  onPreview: (profile: Profile) => void;
  onCreate: (
    profile: Profile,
    password: string,
  ) => Promise<{ vault: Vault; fingerprint: VaultFingerprint }>;
  onDemo: () => Promise<void>;
  onDone: (vault: Vault) => void;
  onTheme: (theme: ThemeSetting) => void;
  onRestore: (backup: VaultBackup, password: string) => Promise<void>;
  /** A device joining a vault that already lives on a sync server. */
  onSignIn: (settings: SyncSettings, header: VaultHeader, password: string) => Promise<void>;
}

export function Onboarding({
  profile,
  onPreview,
  onCreate,
  onDemo,
  onDone,
  onTheme,
  onRestore,
  onSignIn,
}: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [created, setCreated] = useState<{ vault: Vault; fingerprint: VaultFingerprint } | null>(
    null,
  );
  const [strength, setStrength] = useState(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [typed, setTyped] = useState(0);
  const index = NUMBERED.indexOf(step);
  const back = () => setStep(index > 0 ? (NUMBERED[index - 1] as Step) : 'welcome');

  return (
    <main className="onb" data-step={step}>
      <Instrument
        profile={profile}
        step={step}
        fingerprint={created?.fingerprint ?? null}
        lit={step === 'sealed' ? 1 : step === 'master' ? strength : 0}
        turn={(index + 1) * 24 + typed * 7}
      />
      <section className="onb__main" aria-live="polite">
        <header className="onb__bar">
          {index >= 0 ? (
            <span className="onb__step">
              <span className="pv-label">
                Step {index + 1} of {NUMBERED.length}
              </span>
              <span className="onb__ticks" aria-hidden="true">
                {NUMBERED.map((s, i) => (
                  <span key={s} className={i <= index ? 'is-on' : undefined} />
                ))}
              </span>
            </span>
          ) : (
            <button type="button" className="text-btn" onClick={() => setRestoreOpen(true)}>
              <Icon name="upload" />
              Restore a backup
            </button>
          )}
          <span className="onb__tools">
            <ThemeToggle value={profile.theme} onChange={onTheme} />
            {index >= 0 && (
              <button type="button" className="onb__back" onClick={back}>
                <Icon name="back" />
                Back
              </button>
            )}
          </span>
        </header>
        <div className="onb__body" key={step}>
          {step === 'welcome' && (
            <Welcome
              onCreate={() => setStep('you')}
              onDemo={onDemo}
              onSignIn={() => setSignInOpen(true)}
            />
          )}
          {step === 'you' && (
            <YouStep profile={profile} onChange={onPreview} onNext={() => setStep('storage')} />
          )}
          {step === 'storage' && (
            <StorageStep
              mode={profile.storageMode}
              onChange={(storageMode) => onPreview({ ...profile, storageMode })}
              onNext={() => setStep('look')}
            />
          )}
          {step === 'look' && (
            <LookStep profile={profile} onChange={onPreview} onNext={() => setStep('master')} />
          )}
          {step === 'master' && (
            <MasterStep
              profile={profile}
              onLevel={setStrength}
              onTyped={setTyped}
              onCreate={async (password) => {
                setCreated(await onCreate(profile, password));
                setStep('sealed');
              }}
            />
          )}
          {step === 'sealed' && created && (
            <SealedStep fingerprint={created.fingerprint} onDone={() => onDone(created.vault)} />
          )}
        </div>
      </section>
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} onRestore={onRestore} />
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} onSignIn={onSignIn} />
    </main>
  );
}

/** The wordmark: a small dial with its index mark, then the name. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13.4" r="8.6" />
        <circle cx="12" cy="13.4" r="3.6" />
        <path d="M9.3 1.2h5.4L12 4.4z" className="brand__index" />
      </svg>
      {!compact && <span className="brand__name">PassVaultify</span>}
    </span>
  );
}

function stepLabel(step: Step, sealed: boolean): string {
  if (sealed) return 'Sealed';
  if (step === 'master') return 'Waiting for a master password';
  return 'Not created yet';
}

/**
 * The left-hand panel: a live preview of the vault being set up. The dial is a
 * placeholder pattern until the vault is created; then it becomes the real
 * fingerprint, the one the lock screen shows.
 */
function Instrument({
  profile,
  step,
  fingerprint,
  lit,
  turn,
}: {
  profile: Profile;
  step: Step;
  fingerprint: VaultFingerprint | null;
  lit: number;
  turn: number;
}) {
  const preview = useRings(`preview/${profile.vaultName || 'PassVaultify'}`);
  const rings = fingerprint?.rings ?? preview;
  const accent = ACCENTS.find((a) => a.value === profile.accent)?.label ?? '';
  const theme = THEME_OPTIONS.find((t) => t.value === profile.theme)?.label ?? '';
  const sealed = fingerprint !== null;
  return (
    // Always dark, whatever the page theme: the instrument is a fixed object.
    <aside
      className="inst pv-root"
      data-theme="graphite"
      data-accent={profile.accent}
      data-sealed={sealed || undefined}
      aria-label="Vault preview"
    >
      <div className="inst__top">
        <Brand />
        <span className="pv-label">{sealed ? 'Vault sealed' : 'Preview'}</span>
      </div>
      <div className="inst__dial" data-sealed={sealed || undefined}>
        {rings ? (
          <Fingerprint
            bytes={rings}
            size={300}
            bezel
            lit={lit}
            turn={sealed ? 0 : turn}
            glyph={sealed ? 'lock' : 'unlock'}
            {...(sealed ? { label: `Vault fingerprint ${fingerprint.code}` } : {})}
          />
        ) : (
          <span className="inst__dial-placeholder" />
        )}
      </div>
      <div className="inst__id">
        <p className="inst__name">{profile.vaultName || 'Untitled vault'}</p>
        <p className="pv-fp-code">{sealed ? fingerprint.code : '•••• •••• ••••'}</p>
      </div>
      <dl className="spec">
        <SpecRow label="Cipher">AES-256-GCM</SpecRow>
        <SpecRow label="Key">PBKDF2-SHA256 × {DEFAULT_ITERATIONS.toLocaleString('en')}</SpecRow>
        <SpecRow label="Storage">
          {profile.storageMode === 'local' ? 'This device' : 'Your server, connected next'}
        </SpecRow>
        <SpecRow label="Finish">
          {theme} · {accent}
        </SpecRow>
        <SpecRow label="Status">
          <span className="spec__status" data-sealed={sealed || undefined}>
            {stepLabel(step, sealed)}
          </span>
        </SpecRow>
      </dl>
    </aside>
  );
}

function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="spec__row">
      <dt className="pv-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="pv-display onb__title">
      {children}
      <span className="dot">.</span>
    </h1>
  );
}

function Lede({ children }: { children: ReactNode }) {
  return <p className="onb__lede">{children}</p>;
}

function Welcome({
  onCreate,
  onDemo,
  onSignIn,
}: {
  onCreate: () => void;
  onDemo: () => Promise<void>;
  onSignIn: () => void;
}) {
  const [loadingDemo, setLoadingDemo] = useState(false);
  return (
    <div className="onb__step-body onb__welcome">
      <Title>A password manager that can't read your passwords</Title>
      <Lede>
        Your vault is sealed on this device with a key made from your master password. Nobody else
        ever holds that key. Not a server, not us.
      </Lede>
      <div className="onb__actions">
        <Button variant="primary" size="lg" onClick={onCreate}>
          Create a vault
          <Icon name="arrow" />
        </Button>
        <Button
          size="lg"
          disabled={loadingDemo}
          onClick={() => {
            setLoadingDemo(true);
            void onDemo().catch(() => setLoadingDemo(false));
          }}
        >
          {loadingDemo ? 'Preparing the demo…' : 'Explore a demo vault'}
        </Button>
      </div>
      <button type="button" className="text-btn onb__signin" onClick={onSignIn}>
        <Icon name="server" />
        Already syncing on another device? Sign in to your server
      </button>
      <ul className="facts">
        <li>
          <span className="facts__lead">Sealed here</span>
          Every item is encrypted with AES-256-GCM before it's stored.
        </li>
        <li>
          <span className="facts__lead">No account</span>
          In local-only mode, nothing leaves this device. It works offline.
        </li>
        <li>
          <span className="facts__lead">Open format</span>
          Documented, with test vectors anyone can check.
        </li>
      </ul>
    </div>
  );
}

function YouStep({
  profile,
  onChange,
  onNext,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onNext: () => void;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onChange({ ...profile, vaultName: profile.vaultName.trim() || defaultVaultName(profile.name) });
    onNext();
  };
  return (
    <form className="onb__step-body" onSubmit={submit}>
      <Title>Name your vault</Title>
      <Lede>
        It goes on the lock screen next to the vault's fingerprint, so you always know which vault
        you're opening. It stays on this device.
      </Lede>
      <div className="onb__fields">
        <TextField
          label="Your name"
          placeholder="Optional"
          autoComplete="given-name"
          autoFocus
          maxLength={40}
          value={profile.name}
          onChange={(e) => {
            const name = e.target.value;
            const followsName = profile.vaultName === defaultVaultName(profile.name);
            onChange({
              ...profile,
              name,
              vaultName: followsName ? defaultVaultName(name) : profile.vaultName,
            });
          }}
        />
        <TextField
          label="Vault name"
          maxLength={40}
          value={profile.vaultName}
          onChange={(e) => onChange({ ...profile, vaultName: e.target.value })}
        />
      </div>
      <Next type="submit" />
    </form>
  );
}

function Next({
  type = 'button',
  onClick,
  disabled,
  children = 'Continue',
}: {
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="onb__next">
      <Button
        variant="primary"
        size="lg"
        type={type}
        disabled={disabled}
        {...(onClick ? { onClick } : {})}
      >
        {children}
        <Icon name="arrow" />
      </Button>
    </div>
  );
}

const STORAGE: { mode: StorageMode; title: string; body: string; ready: boolean }[] = [
  {
    mode: 'local',
    title: 'This device only',
    body: 'Encrypted in this browser. No account, no network, nothing to breach but this device.',
    ready: true,
  },
  {
    mode: 'self',
    title: 'Your own server',
    body: "Sync through a PassVaultify server you run. It only ever stores ciphertext. You'll connect it once the vault is made.",
    ready: true,
  },
  {
    mode: 'cloud',
    title: 'PassVaultify Cloud',
    body: 'End-to-end encrypted sync across devices, without running anything yourself.',
    ready: false,
  },
];

function StorageStep({
  mode,
  onChange,
  onNext,
}: {
  mode: StorageMode;
  onChange: (mode: StorageMode) => void;
  onNext: () => void;
}) {
  return (
    <div className="onb__step-body">
      <Title>Choose where it lives</Title>
      <Lede>
        Wherever you keep it, the vault is sealed before it's stored. Whoever holds the storage
        holds only ciphertext.
      </Lede>
      <fieldset className="options">
        <legend className="pv-sr">Storage</legend>
        {STORAGE.map((s) => (
          <label key={s.mode} className="option" data-disabled={!s.ready || undefined}>
            <input
              type="radio"
              name="storage"
              value={s.mode}
              checked={mode === s.mode}
              disabled={!s.ready}
              onChange={() => onChange(s.mode)}
            />
            <span className="option__mark" aria-hidden="true" />
            <span className="option__text">
              <span className="option__title">
                {s.title}
                {!s.ready && <Badge>Soon</Badge>}
              </span>
              <span className="option__body">{s.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Next onClick={onNext} />
    </div>
  );
}

/** Theme choice as small renderings of the app itself, not just words. */
export function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeSetting;
  onChange: (theme: ThemeSetting) => void;
}) {
  return (
    <fieldset className="themes">
      <legend className="pv-sr">Theme</legend>
      {THEME_OPTIONS.map((t) => (
        <label key={t.value} className="theme-tile" data-theme-preview={t.value}>
          <input
            type="radio"
            name="theme"
            value={t.value}
            checked={value === t.value}
            onChange={() => onChange(t.value)}
          />
          <span className="theme-tile__art" aria-hidden="true">
            <span className="theme-tile__side" />
            <span className="theme-tile__rows">
              <span />
              <span />
              <span />
            </span>
          </span>
          <span className="theme-tile__label">{t.label}</span>
          <span className="theme-tile__note">{t.note}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function AccentPicker({
  value,
  onChange,
}: {
  value: Accent;
  onChange: (accent: Accent) => void;
}) {
  return (
    <fieldset className="swatches">
      <legend className="pv-sr">Accent color</legend>
      {ACCENTS.map((a) => (
        <label
          key={a.value}
          className="swatch"
          title={a.label}
          data-accent-swatch={a.value}
          style={{ ['--sw' as string]: a.swatch }}
        >
          <input
            type="radio"
            name="accent"
            value={a.value}
            checked={value === a.value}
            onChange={() => onChange(a.value)}
          />
          <span className="swatch__chip" aria-hidden="true" />
          <span className="swatch__label">{a.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function LookStep({
  profile,
  onChange,
  onNext,
}: {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onNext: () => void;
}) {
  return (
    <div className="onb__step-body">
      <Title>Pick a finish</Title>
      <Lede>The whole app follows along, so you can see it before you commit.</Lede>
      <div className="onb__group">
        <span className="pv-label">Theme</span>
        <ThemePicker value={profile.theme} onChange={(theme) => onChange({ ...profile, theme })} />
      </div>
      <div className="onb__group">
        <span className="pv-label">Signal color</span>
        <AccentPicker
          value={profile.accent}
          onChange={(accent) => onChange({ ...profile, accent })}
        />
      </div>
      <Next onClick={onNext} />
    </div>
  );
}

function MasterStep({
  profile,
  onCreate,
  onLevel,
  onTyped,
}: {
  profile: Profile;
  onCreate: (password: string) => Promise<void>;
  onLevel: (level: number) => void;
  onTyped: (length: number) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { strength, current } = useMasterStrength(password, [
    profile.name,
    profile.vaultName,
    'passvaultify',
  ]);

  // Drive the dial's bezel from the strength estimate, and its rings from typing.
  const level = password && strength ? (strength.score + 1) / 5 : 0;
  useEffect(() => onLevel(level), [level, onLevel]);
  useEffect(() => onTyped(password.length), [password.length, onTyped]);

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = current && !!strength?.acceptable && confirm === password && understood && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong creating the vault.');
      setBusy(false);
    }
  };

  return (
    <form className="onb__step-body" onSubmit={(e) => void submit(e)}>
      <Title>Set the combination</Title>
      <Lede>
        Your master password is the only key. We never see it and can't reset it, so make it long
        and memorable. Four or five random words work well.
      </Lede>
      <div className="onb__fields">
        <div className="pw-field">
          <TextField
            label="Master password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            autoFocus
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="pw-field__tools">
            <button type="button" className="text-btn" onClick={() => setShow(!show)}>
              <Icon name={show ? 'eyeOff' : 'eye'} />
              {show ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setPassword(generatePassphrase({ words: 5, separator: '-' }).value);
                setConfirm('');
                setShow(true);
              }}
            >
              <Icon name="refresh" />
              Suggest a passphrase
            </button>
          </div>
        </div>
        <StrengthReadout password={password} strength={strength} />
        <TextField
          label="Type it again"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          {...(mismatch ? { hint: "Doesn't match yet" } : {})}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span className="check__box" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>
            I understand that if I forget it, <strong>this vault can't be recovered</strong>.
          </span>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Next type="submit" disabled={!ready}>
        {busy ? 'Sealing the vault…' : 'Seal the vault'}
      </Next>
    </form>
  );
}

function SealedStep({
  fingerprint,
  onDone,
}: {
  fingerprint: VaultFingerprint;
  onDone: () => void;
}) {
  return (
    <div className="onb__step-body">
      <p className="pv-label onb__kicker">Vault sealed</p>
      <Title>Learn its face</Title>
      <Lede>
        The dial is your vault's fingerprint, drawn from its key. No other vault has it, and the
        lock screen always shows it. If a page asks for your master password without this exact
        pattern, it isn't PassVaultify.
      </Lede>
      <div className="sealed-code">
        <span className="pv-label">Fingerprint code</span>
        <span className="sealed-code__value">{fingerprint.code}</span>
      </div>
      <Next onClick={onDone}>Open the vault</Next>
    </div>
  );
}

/** A new device joining a vault that lives on a sync server. */
function SignInDialog({
  open,
  onOpenChange,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignIn: OnboardingProps['onSignIn'];
}) {
  const [server, setServer] = useState<{ url: string; info: ServerInfo } | null>(null);
  const close = (next: boolean) => {
    if (!next) setServer(null);
    onOpenChange(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Sign in to your server"
      description="Your vault comes down encrypted and opens here with your master password."
    >
      {server ? (
        <AccountStep
          server={server.url}
          info={server.info}
          allowCreate={false}
          onBack={() => setServer(null)}
          onSubmit={async (_mode, email, password) => {
            const { settings, header } = await signInToSync({
              server: server.url,
              serverFingerprint: server.info.fingerprint,
              email,
              password,
              device: { name: deviceName(), kind: 'web' },
            });
            await onSignIn(settings, header, password);
          }}
        />
      ) : (
        <ServerStep onChecked={(url, info) => setServer({ url, info })} />
      )}
    </Dialog>
  );
}
