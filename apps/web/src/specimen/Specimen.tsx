import {
  Badge,
  Button,
  DataChip,
  Fingerprint,
  Icon,
  IconButton,
  SecretText,
  Segmented,
  Switch,
  TextField,
  type StorageMode,
} from '@passvaultify/ui';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { DEMO_PASSWORD, useDemoVault, type DemoItem } from './useDemoVault';

type Theme = 'graphite' | 'porcelain';
type Accent = 'cobalt' | 'jade' | 'amber' | 'rose';

const ACCENTS: { value: Accent; label: string; swatch: string }[] = [
  { value: 'cobalt', label: 'Cobalt', swatch: '#6f8bff' },
  { value: 'jade', label: 'Jade', swatch: '#2fb38a' },
  { value: 'amber', label: 'Amber', swatch: '#e0a43a' },
  { value: 'rose', label: 'Rose', swatch: '#e86a8a' },
];

const TOKENS = [
  'bg',
  'surface',
  'raised',
  'line',
  'ink',
  'ink-2',
  'acc',
  'ok',
  'warn',
  'danger',
] as const;

function initialTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'porcelain'
    : 'graphite';
}

export function Specimen() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accent, setAccent] = useState<Accent>('cobalt');
  const { vault, tryUnlock, decryptDemo } = useDemoVault();

  useEffect(() => {
    document.body.style.background = theme === 'graphite' ? '#0b0d11' : '#f3f4f6';
  }, [theme]);

  return (
    <div className="pv-root spec" data-theme={theme} data-accent={accent}>
      <header className="spec-top">
        <p className="spec-brand">
          PassVaultify <span>Design system</span>
        </p>
        <div className="spec-controls">
          <Segmented
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'graphite', label: 'Graphite' },
              { value: 'porcelain', label: 'Porcelain' },
            ]}
          />
          <fieldset className="spec-accents">
            <legend className="pv-sr">Accent color</legend>
            {ACCENTS.map((a) => (
              <label
                key={a.value}
                className="spec-swatch"
                style={{ '--c': a.swatch } as CSSProperties}
              >
                <input
                  type="radio"
                  name="accent"
                  value={a.value}
                  checked={accent === a.value}
                  onChange={() => setAccent(a.value)}
                />
                <span aria-hidden="true" />
                <span className="pv-sr">{a.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </header>

      <main className="spec-main">
        <section className="spec-hero" aria-labelledby="spec-title">
          <h1 id="spec-title">Quiet surfaces, precise type, and details that do a security job.</h1>
          <p>
            Everything on this page runs the real PassVaultify crypto core in your browser. The
            vault below was just created on this device, and nothing on this page talks to a server.
          </p>
          <p className="spec-stat" role="status">
            {vault.status === 'ready' && (
              <>
                <Icon name="check" /> Keys derived in <b>{Math.round(vault.deriveMs)} ms</b> on this
                device
                <span>
                  PBKDF2-SHA256, {vault.header.kdf.iterations.toLocaleString('en')} iterations
                </span>
              </>
            )}
            {vault.status === 'creating' && 'Deriving keys on this device…'}
            {vault.status === 'error' && `Couldn't create the demo vault: ${vault.message}`}
          </p>
        </section>

        <section className="spec-grid" aria-label="Live components">
          {vault.status === 'ready' ? (
            <>
              <LockCard fingerprint={vault.fingerprint} tryUnlock={tryUnlock} />
              <ItemCard envelope={vault.envelope} decryptDemo={decryptDemo} />
            </>
          ) : (
            <>
              <div className="pv-card spec-card spec-placeholder" aria-hidden="true" />
              <div className="pv-card spec-card spec-placeholder" aria-hidden="true" />
            </>
          )}
          <ComponentsCard />
        </section>

        <section className="spec-section" aria-labelledby="tokens-title">
          <h2 id="tokens-title">Tokens</h2>
          <div className="spec-tokens">
            {TOKENS.map((t) => (
              <div key={t} className="spec-token">
                <span style={{ background: `var(--pv-${t})` }} aria-hidden="true" />
                <code>--pv-{t}</code>
              </div>
            ))}
          </div>
        </section>

        <section className="spec-section" aria-labelledby="type-title">
          <h2 id="type-title">Type</h2>
          <div className="spec-type">
            <p className="spec-type-display">Unlocked in 0.4 s</p>
            <p className="spec-type-body">
              Your vault is encrypted on this device before anything is saved or synced.
            </p>
            <p className="spec-type-mono">
              Il<span className="pv-ch-digit">1</span> O<span className="pv-ch-digit">0</span>{' '}
              <span className="pv-ch-digit">5</span>S <span className="pv-ch-symbol">#!</span>
            </p>
          </div>
        </section>
      </main>

      <footer className="spec-foot">
        P0 specimen. Source and crypto spec:{' '}
        <a href="https://github.com/furmak331/PassVault">github.com/furmak331/PassVault</a>
      </footer>
    </div>
  );
}

function LockCard({
  fingerprint,
  tryUnlock,
}: {
  fingerprint: { rings: Uint8Array; code: string };
  tryUnlock: (pw: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState('');
  const [turn, setTurn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Locked after 15 minutes of inactivity.');
  const [unlocked, setUnlocked] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setMessage('Enter your master password.');
      return;
    }
    if (password.trim().toLowerCase() === 'password') {
      setMessage("That's the most common password in the world, so it isn't this one.");
      return;
    }
    setBusy(true);
    setMessage('Deriving keys…');
    const ok = await tryUnlock(password);
    setBusy(false);
    if (ok) {
      setTurn((t) => t + 180);
      setUnlocked(true);
      setMessage('Unlocked. The vault key was unwrapped on this device.');
    } else {
      setMessage("That password didn't unlock this vault. Check Caps Lock and try again.");
    }
  }

  return (
    <article className="pv-card spec-card spec-lock" aria-labelledby="lock-title">
      <DataChip mode="local" />
      <Fingerprint
        bytes={fingerprint.rings}
        turn={turn}
        glyph="lock"
        label={`Vault fingerprint ${fingerprint.code}`}
      />
      <h3 id="lock-title" className="spec-card-title">
        Furqan&apos;s Vault
      </h3>
      <p className="pv-fp-code">{fingerprint.code}</p>
      <p className="spec-help">
        Check this fingerprint. If it doesn&apos;t match, this page isn&apos;t PassVaultify.
      </p>
      {unlocked ? (
        <Button
          onClick={() => {
            setUnlocked(false);
            setPassword('');
            setTurn(0);
            setMessage('Vault locked.');
          }}
          icon="lock"
        >
          Lock again
        </Button>
      ) : (
        <form className="spec-unlock" onSubmit={onSubmit} noValidate>
          <TextField
            label="Master password"
            hideLabel
            type="password"
            placeholder="Master password"
            autoComplete="off"
            value={password}
            onChange={(e) => {
              setTurn((t) => t + (e.target.value.length > password.length ? 11 : -7));
              setPassword(e.target.value);
            }}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            Unlock
          </Button>
        </form>
      )}
      <p className="spec-msg" role="status">
        {message}
      </p>
      {!unlocked && (
        <p className="spec-hint">
          Demo password: <code>{DEMO_PASSWORD}</code>
        </p>
      )}
    </article>
  );
}

function ItemCard({
  envelope,
  decryptDemo,
}: {
  envelope: string;
  decryptDemo: () => Promise<DemoItem | null>;
}) {
  const [item, setItem] = useState<DemoItem | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [status, setStatus] = useState('');

  async function toggleReveal() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    setItem(item ?? (await decryptDemo()));
    setRevealed(true);
  }

  async function copy() {
    const plain = item ?? (await decryptDemo());
    if (!plain) return;
    setItem(plain);
    try {
      await navigator.clipboard.writeText(plain.password);
      setStatus('Copied.');
    } catch {
      setStatus('Copy is blocked here. Reveal the password and select it instead.');
    }
  }

  return (
    <article className="pv-card spec-card spec-item" aria-labelledby="item-title">
      <div className="spec-item-head">
        <span className="spec-avatar" aria-hidden="true">
          G
        </span>
        <div>
          <h3 id="item-title" className="spec-card-title">
            GitHub
          </h3>
          <p className="spec-sub">furmak331</p>
        </div>
        <Badge tone="ok">2FA on</Badge>
      </div>
      <div className="spec-secret-row">
        <SecretText value={item?.password ?? ''} revealed={revealed && item !== null} />
        <IconButton
          icon={revealed ? 'eyeOff' : 'eye'}
          label={revealed ? 'Hide password' : 'Reveal password'}
          onClick={toggleReveal}
        />
        <IconButton icon="copy" label="Copy password" onClick={copy} />
      </div>
      <p className="spec-msg" role="status">
        {status}
      </p>
      <div className="spec-stored">
        <p className="pv-field__label">What&apos;s actually stored</p>
        <code>{envelope}</code>
        <p className="spec-help">
          AES-256-GCM with a fresh IV, bound to this item&apos;s ID. Reveal decrypts it with the
          vault key in this tab.
        </p>
      </div>
    </article>
  );
}

function ComponentsCard() {
  const [offline, setOffline] = useState(false);
  const [mode, setMode] = useState<StorageMode>('local');
  return (
    <article className="pv-card spec-card spec-components" aria-labelledby="components-title">
      <h3 id="components-title" className="spec-card-title">
        Components
      </h3>
      <div className="spec-row">
        <Button variant="primary">Fill</Button>
        <Button icon="refresh">New password</Button>
        <Button variant="danger">Delete</Button>
        <IconButton icon="lock" label="Lock vault" />
      </div>
      <div className="spec-row">
        <Badge tone="ok">Very strong</Badge>
        <Badge tone="warn">Reused on 3</Badge>
        <Badge tone="danger">Breached</Badge>
        <Badge tone="neutral">17 years old</Badge>
        <Badge tone="accent">Most private</Badge>
      </div>
      <div className="spec-row">
        <Segmented
          label="Storage mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'self', label: 'Self-hosted' },
            { value: 'cloud', label: 'Cloud' },
          ]}
        />
      </div>
      <div className="spec-row">
        <DataChip mode={mode} {...(mode === 'self' ? { where: 'vault.home.arpa' } : {})} />
      </div>
      <div className="spec-row">
        <Switch label="Offline mode" checked={offline} onChange={setOffline} />
      </div>
      <TextField
        label="Server address"
        defaultValue="https://vault.home.arpa"
        hint="Self-hosted servers are verified by fingerprint."
      />
    </article>
  );
}
