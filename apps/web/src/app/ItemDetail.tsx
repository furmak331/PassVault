import {
  hostOf,
  TRASH_RETENTION_DAYS,
  type PasswordChange,
  type VaultItem,
} from '@passvaultify/core';
import { Avatar, Badge, Button, Icon, IconButton, SecretText } from '@passvaultify/ui';
import { useState, type ReactNode } from 'react';
import { exactTime, relativeTime, useCopy } from './hooks';
import { avatarSeed, SHORT_PASSWORD } from './model';

export interface ItemDetailProps {
  item: VaultItem;
  /** Other logins with the same password. */
  reusedBy: VaultItem[];
  onBack: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onPurge: () => void;
  onTag: (tag: string) => void;
  onOpenItem: (id: string) => void;
}

const DAY_MS = 86400_000;

export function ItemDetail(props: ItemDetailProps) {
  const { item, onBack, onEdit, onToggleFavorite, onTrash, onRestore, onPurge, onTag } = props;
  const d = item.data;
  const copy = useCopy();
  const inTrash = d.trashedAt !== null;

  return (
    <article className="detail" aria-label={d.title}>
      <header className="detail__head">
        <IconButton icon="back" label="Back to list" className="only-narrow" onClick={onBack} />
        <Avatar title={d.title} seed={avatarSeed(item)} size="lg" />
        <div className="detail__titles">
          <h2 className="detail__title">{d.title}</h2>
          <span className="detail__kind">{d.type === 'login' ? 'Login' : 'Secure note'}</span>
        </div>
        <div className="detail__tools">
          {inTrash ? (
            <>
              <Button icon="restore" onClick={onRestore}>
                Restore
              </Button>
              <Button variant="danger" icon="trash" onClick={onPurge}>
                Delete forever
              </Button>
            </>
          ) : (
            <>
              <IconButton
                icon="star"
                label={d.favorite ? 'Remove from favorites' : 'Add to favorites'}
                className={d.favorite ? 'is-fav' : undefined}
                aria-pressed={d.favorite}
                onClick={onToggleFavorite}
              />
              <IconButton icon="trash" label="Move to Trash" onClick={onTrash} />
              <Button icon="edit" onClick={onEdit}>
                Edit
              </Button>
            </>
          )}
        </div>
      </header>

      {inTrash && d.trashedAt && (
        <p className="notice">
          <Icon name="trash" />
          In Trash. Deleted forever{' '}
          {relativeTime(
            new Date(Date.parse(d.trashedAt) + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
          )}
          .
        </p>
      )}

      {d.type === 'login' && (
        <>
          {!inTrash && (
            <Health password={d.password} reusedBy={props.reusedBy} onOpenItem={props.onOpenItem} />
          )}
          <dl className="fields">
            {d.username && (
              <Field label="Username" onCopy={() => copy(d.username, 'Username')}>
                <span className="field__value">{d.username}</span>
              </Field>
            )}
            {d.password && (
              <PasswordField password={d.password} onCopy={() => copy(d.password, 'Password')} />
            )}
            {d.urls.length > 0 && (
              <Field label={d.urls.length === 1 ? 'Website' : 'Websites'}>
                <ul className="urls">
                  {d.urls.map((url) => (
                    <li key={url}>
                      <a href={safeHref(url)} target="_blank" rel="noopener noreferrer">
                        {hostOf(url) ?? url}
                        <Icon name="external" />
                      </a>
                    </li>
                  ))}
                </ul>
              </Field>
            )}
          </dl>
        </>
      )}

      {d.notes && (
        <dl className="fields">
          <Field label={d.type === 'note' ? 'Note' : 'Notes'} onCopy={() => copy(d.notes, 'Note')}>
            <p className="field__notes">{d.notes}</p>
          </Field>
        </dl>
      )}

      {d.tags.length > 0 && (
        <div className="detail__tags">
          {d.tags.map((t) => (
            <button key={t} type="button" className="tag" onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {d.type === 'login' && d.passwordHistory.length > 0 && (
        <History history={d.passwordHistory} onCopy={(p) => copy(p, 'Old password')} />
      )}

      <footer className="detail__meta">
        <span title={exactTime(d.createdAt)}>Created {relativeTime(d.createdAt)}</span>
        <span title={exactTime(item.updatedAt)}>Updated {relativeTime(item.updatedAt)}</span>
      </footer>
    </article>
  );
}

/** Only http(s) links are clickable; anything else (javascript:, data:) is treated as a host name. */
function safeHref(url: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  return /^https?:\/\//i.test(withScheme) ? withScheme : `https://${hostOf(url) ?? ''}`;
}

function Field({
  label,
  onCopy,
  children,
}: {
  label: string;
  onCopy?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <dt className="field__label">{label}</dt>
      <dd className="field__body">
        {children}
        {onCopy && (
          <IconButton icon="copy" label={`Copy ${label.toLowerCase()}`} onClick={onCopy} />
        )}
      </dd>
    </div>
  );
}

function PasswordField({ password, onCopy }: { password: string; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="field">
      <dt className="field__label">Password</dt>
      <dd className="field__body">
        <SecretText value={password} revealed={revealed} />
        <IconButton
          icon={revealed ? 'eyeOff' : 'eye'}
          label={revealed ? 'Hide password' : 'Reveal password'}
          onClick={() => setRevealed(!revealed)}
        />
        <IconButton icon="copy" label="Copy password" onClick={onCopy} />
      </dd>
    </div>
  );
}

function Health({
  password,
  reusedBy,
  onOpenItem,
}: {
  password: string;
  reusedBy: VaultItem[];
  onOpenItem: (id: string) => void;
}) {
  const short = password.length > 0 && password.length < SHORT_PASSWORD;
  if (reusedBy.length === 0 && !short) return null;
  return (
    <div className="health" role="note">
      {reusedBy.length > 0 && (
        <p>
          <Badge tone="warn">Reused</Badge>
          <span>
            Same password as{' '}
            {reusedBy.map((other, i) => (
              <span key={other.id}>
                {i > 0 && (i === reusedBy.length - 1 ? ' and ' : ', ')}
                <button type="button" className="link" onClick={() => onOpenItem(other.id)}>
                  {other.data.title}
                </button>
              </span>
            ))}
            . One leak would unlock {reusedBy.length === 1 ? 'both' : 'all of them'}.
          </span>
        </p>
      )}
      {short && (
        <p>
          <Badge tone="danger">Short</Badge>
          <span>
            Only {password.length} characters. Generate a longer one when you next change it.
          </span>
        </p>
      )}
    </div>
  );
}

function History({
  history,
  onCopy,
}: {
  history: PasswordChange[];
  onCopy: (password: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="history">
      <button
        type="button"
        className="history__toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="history" />
        Password history
        <span className="history__count">{history.length}</span>
      </button>
      {open && (
        <ol className="history__list">
          {history.map((h, i) => (
            <HistoryRow key={`${h.changedAt}-${i}`} change={h} onCopy={() => onCopy(h.password)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function HistoryRow({ change, onCopy }: { change: PasswordChange; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <li className="history__row">
      <span className="history__when" title={exactTime(change.changedAt)}>
        Replaced {relativeTime(change.changedAt)}
      </span>
      <div className="field__body">
        <SecretText value={change.password} revealed={revealed} />
        <IconButton
          icon={revealed ? 'eyeOff' : 'eye'}
          label={revealed ? 'Hide' : 'Reveal'}
          onClick={() => setRevealed(!revealed)}
        />
        <IconButton icon="copy" label="Copy old password" onClick={onCopy} />
      </div>
    </li>
  );
}
