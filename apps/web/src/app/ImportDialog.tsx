import {
  BackupError,
  DecryptionError,
  duplicateKey,
  ImportError,
  importCsv,
  openBackup,
  parseBackup,
  SOURCE_LABELS,
  type ItemData,
  type NewItem,
  type SkippedRow,
  type Vault,
  type VaultBackup,
} from '@passvaultify/core';
import { Button, Dialog, Icon, Meter } from '@passvaultify/ui';
import { useId, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { looksLikeBackup, readTextFile } from './files';
import { exactTime } from './hooks';

type Pending = { kind: 'new'; item: NewItem } | { kind: 'data'; item: ItemData };

type Stage =
  | { name: 'choose'; error?: string | undefined }
  | {
      name: 'unlock';
      backup: VaultBackup;
      fileName: string;
      error?: string | undefined;
      busy?: boolean | undefined;
    }
  | {
      name: 'preview';
      kind: 'csv' | 'backup';
      from: string;
      fileName: string;
      fresh: Pending[];
      duplicates: number;
      skipped: SkippedRow[];
    }
  | { name: 'importing'; done: number; total: number }
  | { name: 'done'; count: number; kind: 'csv' | 'backup'; fileName: string };

function errorMessage(err: unknown): string {
  if (err instanceof ImportError || err instanceof BackupError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Choosing a file: drag and drop, or the system picker. */
export function FileDrop({
  accept,
  onFile,
  children,
}: {
  accept: string;
  onFile: (file: File) => void;
  children: ReactNode;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };
  return (
    <div
      className="drop"
      data-over={over || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <Icon name="upload" />
      <div className="drop__text">{children}</div>
      <label htmlFor={inputId} className="pv-btn pv-btn--ghost drop__pick">
        Choose file…
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="pv-sr"
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function BackupUnlock({
  backup,
  fileName,
  error,
  busy,
  onSubmit,
  onBack,
  submitLabel,
}: {
  backup: VaultBackup;
  fileName: string;
  error: string | undefined;
  busy: boolean | undefined;
  onSubmit: (password: string) => void;
  onBack: () => void;
  submitLabel: string;
}) {
  const [password, setPassword] = useState('');
  const inputId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password && !busy) onSubmit(password);
  };
  return (
    <form className="stack" onSubmit={submit}>
      <dl className="file-facts">
        <div>
          <dt className="pv-label">File</dt>
          <dd>{fileName}</dd>
        </div>
        {backup.vaultName && (
          <div>
            <dt className="pv-label">Vault</dt>
            <dd>{backup.vaultName}</dd>
          </div>
        )}
        <div>
          <dt className="pv-label">Made</dt>
          <dd>{backup.exportedAt ? exactTime(backup.exportedAt) : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="pv-label">Items</dt>
          <dd>{backup.records.length}</dd>
        </div>
        <div>
          <dt className="pv-label">Fingerprint</dt>
          <dd className="pv-fp-code">{backup.header.fingerprint}</dd>
        </div>
      </dl>
      <div className="pv-field">
        <label htmlFor={inputId} className="pv-field__label">
          Master password of this backup
        </label>
        <input
          id={inputId}
          className="pv-input"
          type="password"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          value={password}
          readOnly={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="pv-field__hint">
          The password the vault had when this backup was made, which may be an older one.
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button onClick={onBack}>Choose another file</Button>
        <Button variant="primary" type="submit" disabled={!password || busy}>
          {busy ? 'Decrypting…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: Vault;
  /** Called once items have been written, so the list can refresh. */
  onImported: (count: number) => void;
}

/**
 * Bring items in from another password manager's CSV export, or merge a
 * PassVaultify backup. Shows what will happen before writing anything.
 */
export function ImportDialog({ open, onOpenChange, vault, onImported }: ImportDialogProps) {
  const [stage, setStage] = useState<Stage>({ name: 'choose' });
  const [tag, setTag] = useState(true);

  const close = (next: boolean) => {
    if (stage.name === 'importing') return;
    if (!next) setStage({ name: 'choose' });
    onOpenChange(next);
  };

  /** Split incoming items into new ones and ones the vault already has. */
  const preview = (
    kind: 'csv' | 'backup',
    from: string,
    fileName: string,
    incoming: Pending[],
    skipped: SkippedRow[],
  ) => {
    const seen = new Set(vault.list().map((i) => duplicateKey(i.data)));
    const fresh: Pending[] = [];
    let duplicates = 0;
    for (const entry of incoming) {
      const key = duplicateKey(entry.item);
      if (seen.has(key)) duplicates++;
      else {
        seen.add(key);
        fresh.push(entry);
      }
    }
    setStage({ name: 'preview', kind, from, fileName, fresh, duplicates, skipped });
  };

  const onFile = async (file: File) => {
    try {
      const text = await readTextFile(file);
      if (looksLikeBackup(text)) {
        setStage({ name: 'unlock', backup: parseBackup(text), fileName: file.name });
      } else {
        const result = importCsv(text);
        preview(
          'csv',
          SOURCE_LABELS[result.source],
          file.name,
          result.items.map((item) => ({ kind: 'new', item })),
          result.skipped,
        );
      }
    } catch (err) {
      setStage({ name: 'choose', error: errorMessage(err) });
    }
  };

  const unlockBackup = async (password: string) => {
    if (stage.name !== 'unlock') return;
    setStage({ ...stage, busy: true, error: undefined });
    try {
      const items = await openBackup(stage.backup, password);
      preview(
        'backup',
        stage.backup.vaultName ? `the backup of ${stage.backup.vaultName}` : 'the backup',
        stage.fileName,
        items.filter((i) => !i.data.trashedAt).map(({ data }) => ({ kind: 'data', item: data })),
        [],
      );
    } catch (err) {
      setStage({
        ...stage,
        busy: false,
        error:
          err instanceof DecryptionError
            ? "That password doesn't open this backup."
            : errorMessage(err),
      });
    }
  };

  const runImport = async () => {
    if (stage.name !== 'preview') return;
    const { fresh, kind, fileName } = stage;
    const withTag = (tags: string[] | undefined) => (tag ? [...(tags ?? []), 'imported'] : tags);
    setStage({ name: 'importing', done: 0, total: fresh.length });
    let done = 0;
    for (const entry of fresh) {
      if (entry.kind === 'new') {
        const tags = withTag(entry.item.tags);
        await vault.add({ ...entry.item, ...(tags ? { tags } : {}) });
      } else {
        await vault.importItem({ ...entry.item, tags: withTag(entry.item.tags) ?? [] });
      }
      done++;
      if (done % 10 === 0 || done === fresh.length) {
        setStage({ name: 'importing', done, total: fresh.length });
      }
    }
    onImported(done);
    setStage({ name: 'done', count: done, kind, fileName });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Import"
      {...(stage.name === 'choose'
        ? {
            description:
              'Bring in passwords from another app, or merge a PassVaultify backup. Everything happens on this device.',
          }
        : {})}
      size="lg"
    >
      {stage.name === 'choose' && (
        <>
          <FileDrop accept=".csv,.json,text/csv,application/json" onFile={(f) => void onFile(f)}>
            <strong>Drop a CSV export or a PassVaultify backup</strong>
            <span>Chrome, Edge, Brave, Firefox, Bitwarden and 1Password exports work.</span>
          </FileDrop>
          {stage.error && (
            <p className="form-error" role="alert">
              {stage.error}
            </p>
          )}
          <details className="howto">
            <summary>How to export from another app</summary>
            <dl>
              <div>
                <dt>Chrome, Edge, Brave</dt>
                <dd>Password Manager → Settings → Export passwords</dd>
              </div>
              <div>
                <dt>Firefox</dt>
                <dd>about:logins → ⋯ menu → Export passwords</dd>
              </div>
              <div>
                <dt>Bitwarden</dt>
                <dd>Tools → Export vault → format .csv</dd>
              </div>
              <div>
                <dt>1Password</dt>
                <dd>File → Export → choose CSV</dd>
              </div>
            </dl>
          </details>
        </>
      )}

      {stage.name === 'unlock' && (
        <BackupUnlock
          backup={stage.backup}
          fileName={stage.fileName}
          error={stage.error}
          busy={stage.busy}
          submitLabel="Open backup"
          onSubmit={(pw) => void unlockBackup(pw)}
          onBack={() => setStage({ name: 'choose' })}
        />
      )}

      {stage.name === 'preview' && (
        <div className="stack">
          <div className="tally">
            <div className="tally__main">
              <span className="tally__n pv-num">{stage.fresh.length}</span>
              <span>
                {stage.fresh.length === 1 ? 'item' : 'items'} ready to import from {stage.from}
              </span>
            </div>
            {stage.duplicates > 0 && (
              <p>
                {stage.duplicates} {stage.duplicates === 1 ? 'is' : 'are'} already in this vault and
                will be skipped.
              </p>
            )}
            {stage.skipped.length > 0 && (
              <details>
                <summary>
                  {stage.skipped.length} {stage.skipped.length === 1 ? 'row' : 'rows'} can't be
                  imported
                </summary>
                <ul className="skipped">
                  {stage.skipped.slice(0, 50).map((s) => (
                    <li key={s.line}>
                      <span className="pv-num">Line {s.line}</span> {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {stage.fresh.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={tag} onChange={(e) => setTag(e.target.checked)} />
              <span className="check__box" aria-hidden="true">
                <Icon name="check" />
              </span>
              <span>
                Tag them <strong>#imported</strong>, so they're easy to review afterwards
              </span>
            </label>
          )}
          <div className="dialog-actions">
            <Button onClick={() => setStage({ name: 'choose' })}>Choose another file</Button>
            <Button
              variant="primary"
              disabled={stage.fresh.length === 0}
              onClick={() => void runImport()}
            >
              {stage.fresh.length === 0
                ? 'Nothing new to import'
                : `Import ${stage.fresh.length} ${stage.fresh.length === 1 ? 'item' : 'items'}`}
            </Button>
          </div>
        </div>
      )}

      {stage.name === 'importing' && (
        <div className="stack" role="status">
          <p className="tally__main">
            <span className="tally__n pv-num">{stage.done}</span>
            <span>of {stage.total} sealed and saved</span>
          </p>
          <Meter
            value={stage.total ? (stage.done / stage.total) * 5 : 5}
            tone="ok"
            label={`Imported ${stage.done} of ${stage.total}`}
          />
        </div>
      )}

      {stage.name === 'done' && (
        <div className="stack">
          <p className="tally__main">
            <span className="tally__n pv-num">{stage.count}</span>
            <span>{stage.count === 1 ? 'item' : 'items'} imported and sealed</span>
          </p>
          {stage.kind === 'csv' && (
            <div className="flag" data-tone="danger">
              <span className="flag__name">Now</span>
              <span>
                Delete <strong>{stage.fileName}</strong> and empty your computer's trash. It holds
                your passwords in plain text, so anyone who opens it can read every one.
              </span>
            </div>
          )}
          <div className="dialog-actions">
            <Button variant="primary" autoFocus onClick={() => close(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * On the welcome screen: bring back a vault from a backup file, as the vault on
 * this device. Nothing is written until the password has opened every item.
 */
export function RestoreDialog({
  open,
  onOpenChange,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (backup: VaultBackup, password: string) => Promise<void>;
}) {
  const [stage, setStage] = useState<
    | { name: 'choose'; error?: string | undefined }
    | {
        name: 'unlock';
        backup: VaultBackup;
        fileName: string;
        error?: string | undefined;
        busy?: boolean | undefined;
      }
  >({ name: 'choose' });

  const close = (next: boolean) => {
    if (!next) setStage({ name: 'choose' });
    onOpenChange(next);
  };

  const onFile = async (file: File) => {
    try {
      setStage({
        name: 'unlock',
        backup: parseBackup(await readTextFile(file)),
        fileName: file.name,
      });
    } catch (err) {
      setStage({ name: 'choose', error: errorMessage(err) });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Restore from a backup"
      description="The vault comes back exactly as it was, fingerprint included."
    >
      {stage.name === 'choose' ? (
        <>
          <FileDrop accept=".json,application/json" onFile={(f) => void onFile(f)}>
            <strong>Drop a PassVaultify backup</strong>
            <span>The .json file you downloaded from Settings.</span>
          </FileDrop>
          {stage.error && (
            <p className="form-error" role="alert">
              {stage.error}
            </p>
          )}
        </>
      ) : (
        <BackupUnlock
          backup={stage.backup}
          fileName={stage.fileName}
          error={stage.error}
          busy={stage.busy}
          submitLabel="Restore vault"
          onBack={() => setStage({ name: 'choose' })}
          onSubmit={(password) => {
            const current = stage;
            setStage({ ...current, busy: true, error: undefined });
            onRestore(current.backup, password).catch((err: unknown) =>
              setStage({
                ...current,
                busy: false,
                error:
                  err instanceof DecryptionError
                    ? "That password doesn't open this backup."
                    : errorMessage(err),
              }),
            );
          }}
        />
      )}
    </Dialog>
  );
}
