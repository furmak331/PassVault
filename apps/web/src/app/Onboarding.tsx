import {
  generatePassphrase,
  type Fingerprint as VaultFingerprint,
  type Vault,
} from '@passvaultify/core';
import {
  Badge,
  Button,
  DataChip,
  Fingerprint,
  Icon,
  Segmented,
  TextField,
  type IconName,
} from '@passvaultify/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { StrengthReadout, useMasterStrength } from './MasterStrength';
import {
  ACCENTS,
  defaultVaultName,
  type Profile,
  type StorageMode,
  type ThemeSetting,
} from './profile';

type Step = 'welcome' | 'you' | 'storage' | 'look' | 'master' | 'fingerprint';
const NUMBERED: Step[] = ['you', 'storage', 'look', 'master'];

export const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'porcelain', label: 'Porcelain' },
];

export interface OnboardingProps {
  profile: Profile;
  /** Called as appearance choices change, so the whole page previews them. */
  onPreview: (profile: Profile) => void;
  onCreate: (
    profile: Profile,
    password: string,
  ) => Promise<{ vault: Vault; fingerprint: VaultFingerprint }>;
  onDemo: () => Promise<void>;
  onDone: (vault: Vault) => void;
}

export function Onboarding({ profile, onPreview, onCreate, onDemo, onDone }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [created, setCreated] = useState<{ vault: Vault; fingerprint: VaultFingerprint } | null>(
    null,
  );
  const index = NUMBERED.indexOf(step);
  const back = index > 0 ? () => setStep(NUMBERED[index - 1] as Step) : () => setStep('welcome');

  return (
    <main className="onb">
      <header className="onb__top">
        <Brand />
        {index >= 0 && (
          <span className="onb__progress" aria-label={`Step ${index + 1} of ${NUMBERED.length}`}>
            {NUMBERED.map((s, i) => (
              <span key={s} className={i <= index ? 'is-on' : undefined} />
            ))}
          </span>
        )}
      </header>
      <section className="onb__card pv-card" aria-live="polite">
        {step === 'welcome' && <Welcome onCreate={() => setStep('you')} onDemo={onDemo} />}
        {step === 'you' && (
          <YouStep
            profile={profile}
            onChange={onPreview}
            onBack={back}
            onNext={() => setStep('storage')}
          />
        )}
        {step === 'storage' && (
          <StorageStep
            mode={profile.storageMode}
            onChange={(storageMode) => onPreview({ ...profile, storageMode })}
            onBack={back}
            onNext={() => setStep('look')}
          />
        )}
        {step === 'look' && (
          <LookStep
            profile={profile}
            onChange={onPreview}
            onBack={back}
            onNext={() => setStep('master')}
          />
        )}
        {step === 'master' && (
          <MasterStep
            profile={profile}
            onBack={back}
            onCreate={async (password) => {
              setCreated(await onCreate(profile, password));
              setStep('fingerprint');
            }}
          />
        )}
        {step === 'fingerprint' && created && (
          <FingerprintStep fingerprint={created.fingerprint} onDone={() => onDone(created.vault)} />
        )}
      </section>
      <footer className="onb__foot">
        <DataChip mode={profile.storageMode} />
      </footer>
    </main>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <span className="brand__mark" aria-hidden="true">
        <Icon name="lock" />
      </span>
      PassVaultify
    </span>
  );
}

function StepHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="onb__head">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="onb__title">{title}</h1>
      {children && <p className="onb__lede">{children}</p>}
    </div>
  );
}

function StepNav({ onBack, next }: { onBack: () => void; next: ReactNode }) {
  return (
    <div className="onb__nav">
      <Button icon="back" onClick={onBack}>
        Back
      </Button>
      {next}
    </div>
  );
}

function Welcome({ onCreate, onDemo }: { onCreate: () => void; onDemo: () => Promise<void> }) {
  const [loadingDemo, setLoadingDemo] = useState(false);
  return (
    <>
      <StepHead title="A password manager that can't read your passwords.">
        Your vault is encrypted on this device with a key made from your master password. Nobody
        else ever holds that key, including us.
      </StepHead>
      <ul className="facts">
        <Fact icon="key">AES-256-GCM, with keys stretched by 600,000 rounds of PBKDF2</Fact>
        <Fact icon="device">Works offline. In local-only mode nothing leaves this device</Fact>
        <Fact icon="shield">An open, documented format with published test vectors</Fact>
      </ul>
      <div className="onb__actions">
        <Button variant="primary" size="lg" onClick={onCreate}>
          Create a vault
        </Button>
        <Button
          size="lg"
          disabled={loadingDemo}
          onClick={() => {
            setLoadingDemo(true);
            void onDemo().catch(() => setLoadingDemo(false));
          }}
        >
          {loadingDemo ? 'Preparing the demo…' : 'Explore the demo vault'}
        </Button>
      </div>
      <p className="onb__fine">
        The demo uses sample data, kept in memory and gone when you close the tab.
      </p>
    </>
  );
}

function Fact({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <li className="fact">
      <span className="fact__icon">
        <Icon name={icon} />
      </span>
      {children}
    </li>
  );
}

interface StepProps {
  profile: Profile;
  onChange: (profile: Profile) => void;
  onBack: () => void;
  onNext: () => void;
}

function YouStep({ profile, onChange, onBack, onNext }: StepProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onChange({ ...profile, vaultName: profile.vaultName.trim() || defaultVaultName(profile.name) });
    onNext();
  };
  return (
    <form className="onb__form" onSubmit={submit}>
      <StepHead eyebrow="Make it yours" title="What should we call you?">
        Shown on your lock screen, so you know you're unlocking the right vault. It stays on this
        device.
      </StepHead>
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
      <StepNav
        onBack={onBack}
        next={
          <Button variant="primary" type="submit">
            Continue
          </Button>
        }
      />
    </form>
  );
}

const STORAGE: {
  mode: StorageMode;
  icon: IconName;
  title: string;
  body: string;
  ready: boolean;
}[] = [
  {
    mode: 'local',
    icon: 'device',
    title: 'Local only',
    body: 'Encrypted in this browser. No account and no network: the vault never leaves this device.',
    ready: true,
  },
  {
    mode: 'self',
    icon: 'server',
    title: 'Self-hosted',
    body: 'Sync through a PassVaultify server you run. It stores ciphertext only.',
    ready: false,
  },
  {
    mode: 'cloud',
    icon: 'cloud',
    title: 'PassVaultify Cloud',
    body: 'Sync across devices with end-to-end encryption, without running a server.',
    ready: false,
  },
];

function StorageStep({
  mode,
  onChange,
  onBack,
  onNext,
}: {
  mode: StorageMode;
  onChange: (mode: StorageMode) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="onb__form">
      <StepHead eyebrow="Your data, your call" title="Where should your vault live?">
        Whichever you pick, everything is encrypted before it's stored. You can move it later.
      </StepHead>
      <fieldset className="choices">
        <legend className="pv-sr">Storage</legend>
        {STORAGE.map((s) => (
          <label key={s.mode} className="choice" data-disabled={!s.ready || undefined}>
            <input
              type="radio"
              name="storage"
              value={s.mode}
              checked={mode === s.mode}
              disabled={!s.ready}
              onChange={() => onChange(s.mode)}
            />
            <span className="choice__icon">
              <Icon name={s.icon} />
            </span>
            <span className="choice__text">
              <span className="choice__title">
                {s.title}
                {!s.ready && <Badge>Coming soon</Badge>}
              </span>
              <span className="choice__body">{s.body}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <StepNav
        onBack={onBack}
        next={
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        }
      />
    </div>
  );
}

export function AccentPicker({
  value,
  onChange,
}: {
  value: Profile['accent'];
  onChange: (a: Profile['accent']) => void;
}) {
  return (
    <fieldset className="swatches">
      <legend className="pv-sr">Accent color</legend>
      {ACCENTS.map((a) => (
        <label
          key={a.value}
          className="swatch"
          title={a.label}
          style={{ ['--sw' as string]: a.swatch }}
        >
          <input
            type="radio"
            name="accent"
            value={a.value}
            checked={value === a.value}
            onChange={() => onChange(a.value)}
          />
          <span className="pv-sr">{a.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function LookStep({ profile, onChange, onBack, onNext }: StepProps) {
  return (
    <div className="onb__form">
      <StepHead eyebrow="Make it yours" title="Pick a look">
        Graphite for low light, Porcelain for daylight, or follow your system.
      </StepHead>
      <div className="row-setting">
        <span className="row-setting__label">Theme</span>
        <Segmented
          label="Theme"
          value={profile.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => onChange({ ...profile, theme })}
        />
      </div>
      <div className="row-setting">
        <span className="row-setting__label">Accent</span>
        <AccentPicker
          value={profile.accent}
          onChange={(accent) => onChange({ ...profile, accent })}
        />
      </div>
      <StepNav
        onBack={onBack}
        next={
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        }
      />
    </div>
  );
}

function MasterStep({
  profile,
  onBack,
  onCreate,
}: {
  profile: Profile;
  onBack: () => void;
  onCreate: (password: string) => Promise<void>;
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
    <form className="onb__form" onSubmit={(e) => void submit(e)}>
      <StepHead eyebrow="The one password to remember" title="Choose a master password">
        It's the only key to your vault. We never see it and can't reset it, so make it long and
        memorable. A few random words work well.
      </StepHead>
      <div className="field-with-action">
        <TextField
          label="Master password"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          autoFocus
          spellCheck={false}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="field-actions">
          <Button icon={show ? 'eyeOff' : 'eye'} onClick={() => setShow(!show)}>
            {show ? 'Hide' : 'Show'}
          </Button>
          <Button
            icon="refresh"
            onClick={() => {
              setPassword(generatePassphrase({ words: 5, separator: '-' }).value);
              setConfirm('');
              setShow(true);
            }}
          >
            Suggest one
          </Button>
        </div>
      </div>
      <StrengthReadout password={password} strength={strength} />
      <TextField
        label="Confirm master password"
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
        <span>
          I understand that if I forget my master password,{' '}
          <strong>my vault can't be recovered</strong>.
        </span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <StepNav
        onBack={onBack}
        next={
          <Button variant="primary" type="submit" disabled={!ready}>
            {busy ? 'Creating vault…' : 'Create vault'}
          </Button>
        }
      />
    </form>
  );
}

function FingerprintStep({
  fingerprint,
  onDone,
}: {
  fingerprint: VaultFingerprint;
  onDone: () => void;
}) {
  return (
    <div className="onb__form onb__form--center">
      <Fingerprint
        bytes={fingerprint.rings}
        size={184}
        label={`Vault fingerprint ${fingerprint.code}`}
      />
      <p className="pv-fp-code">{fingerprint.code}</p>
      <StepHead eyebrow="Vault created" title="Meet your vault's fingerprint">
        This pattern comes from your vault's key, so no other vault has it. You'll see it every time
        you unlock. If a page asks for your master password without showing this exact pattern,
        don't type it.
      </StepHead>
      <div className="onb__actions">
        <Button variant="primary" size="lg" autoFocus onClick={onDone}>
          Open my vault
        </Button>
      </div>
    </div>
  );
}
