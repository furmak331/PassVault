import {
  hostOf,
  TRASH_RETENTION_DAYS,
  type PasswordChange,
  type VaultItem,
} from '@passvaultify/core';
import { Avatar, Button, charKind, Dialog, Icon, IconButton, SecretText } from '@passvaultify/ui';
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
  const host = d.type === 'login' && d.urls[0] ? hostOf(d.urls[0]) : null;

  return (
    <article className="detail" aria-label={d.title}>
      <div className="detail__bar">
        <IconButton icon="back" label="Back to list" className="only-narrow" onClick={onBack} />
        <span className="detail__spacer" />
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

      <header className="detail__hero">
        <Avatar title={d.title} seed={avatarSeed(item)} size="lg" />
        <div className="detail__titles">
          <p className="pv-label">
            {d.type === 'login' ? 'Login' : 'Secure note'}
            {host && <span className="detail__host"> · {host}</span>}
          </p>
          <h2 className="pv-display detail__title">{d.title}</h2>
        </div>
      </header>

      {inTrash && d.trashedAt && (
        <p className="notice">
          <Icon name="trash" />
          <span>
            In Trash. Deleted forever{' '}
            {relativeTime(
              new Date(Date.parse(d.trashedAt) + TRASH_RETENTION_DAYS * DAY_MS).toISOString(),
            )}
            , unless you restore it.
          </span>
        </p>
      )}

      {d.type === 'login' && !inTrash && (
        <Health password={d.password} reusedBy={props.reusedBy} onOpenItem={props.onOpenItem} />
      )}

      <dl className="sheet">
        {d.type === 'login' && d.username && (
          <Row
            label="Username"
            actions={<CopyButton what="username" onCopy={() => copy(d.username, 'Username')} />}
          >
            <span className="sheet__value">{d.username}</span>
          </Row>
        )}
        {d.type === 'login' && d.password && (
          <PasswordRow password={d.password} onCopy={() => copy(d.password, 'Password')} />
        )}
        {d.type === 'login' && d.urls.length > 0 && (
          <Row label={d.urls.length === 1 ? 'Website' : 'Websites'}>
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
          </Row>
        )}
        {d.notes && (
          <Row
            label={d.type === 'note' ? 'Note' : 'Notes'}
            actions={<CopyButton what="note" onCopy={() => copy(d.notes, 'Note')} />}
          >
            <p className="sheet__notes">{d.notes}</p>
          </Row>
        )}
        {d.tags.length > 0 && (
          <Row label="Tags">
            <span className="tags">
              {d.tags.map((t) => (
                <button key={t} type="button" className="tag" onClick={() => onTag(t)}>
                  {t}
                </button>
              ))}
            </span>
          </Row>
        )}
      </dl>

      {d.type === 'login' && d.passwordHistory.length > 0 && (
        <History history={d.passwordHistory} onCopy={(p) => copy(p, 'Old password')} />
      )}

      <footer className="detail__meta">
        <span title={exactTime(d.createdAt)}>Created {relativeTime(d.createdAt)}</span>
        <span title={exactTime(item.updatedAt)}>Updated {relativeTime(item.updatedAt)}</span>
        <span>Revision {item.revision}</span>
      </footer>
    </article>
  );
}

/** Only http(s) links are clickable; anything else (javascript:, data:) is treated as a host name. */
function safeHref(url: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
  return /^https?:\/\//i.test(withScheme) ? withScheme : `https://${hostOf(url) ?? ''}`;
}

function Row({
  label,
  actions,
  children,
}: {
  label: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sheet__row">
      <dt className="pv-label sheet__label">{label}</dt>
      <dd className="sheet__body">
        <div className="sheet__content">{children}</div>
        {actions && <div className="sheet__actions">{actions}</div>}
      </dd>
    </div>
  );
}

function CopyButton({ what, onCopy }: { what: string; onCopy: () => void }) {
  return <IconButton icon="copy" label={`Copy ${what}`} onClick={onCopy} />;
}

function PasswordRow({ password, onCopy }: { password: string; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [large, setLarge] = useState(false);
  return (
    <Row
      label="Password"
      actions={
        <>
          <IconButton
            icon={revealed ? 'eyeOff' : 'eye'}
            label={revealed ? 'Hide password' : 'Reveal password'}
            onClick={() => setRevealed(!revealed)}
          />
          <IconButton icon="type" label="Show in large type" onClick={() => setLarge(true)} />
          <CopyButton what="password" onCopy={onCopy} />
        </>
      }
    >
      <SecretText value={password} revealed={revealed} />
      <LargeType open={large} onOpenChange={setLarge} value={password} />
    </Row>
  );
}

/**
 * Every character in its own numbered cell, for typing a password into another
 * device (a TV, a console) without miscounting or mixing up look-alikes.
 */
function LargeType({
  open,
  onOpenChange,
  value,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
}) {
  const chars = [...value];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Large type"
      description={`${chars.length} characters. Digits and symbols are colored so look-alikes are easy to tell apart.`}
      size="lg"
    >
      <ol className="large-type">
        {chars.map((ch, i) => (
          <li key={i} data-kind={charKind(ch)}>
            <span className="large-type__ch">{ch === ' ' ? '␣' : ch}</span>
            <span className="large-type__n">{i + 1}</span>
          </li>
        ))}
      </ol>
    </Dialog>
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
    <ul className="flags" aria-label="Password health">
      {reusedBy.length > 0 && (
        <li className="flag" data-tone="warn">
          <span className="flag__name">Reused</span>
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
            . One leak would open {reusedBy.length === 1 ? 'both' : 'all of them'}.
          </span>
        </li>
      )}
      {short && (
        <li className="flag" data-tone="danger">
          <span className="flag__name">Short</span>
          <span>
            Only {password.length} characters. Generate a longer one next time you change it.
          </span>
        </li>
      )}
    </ul>
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
        <span className="pv-label">Password history</span>
        <span className="history__count">{history.length}</span>
        <Icon name="back" className="history__chev" />
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
        {relativeTime(change.changedAt)}
      </span>
      <SecretText value={change.password} revealed={revealed} />
      <span className="sheet__actions">
        <IconButton
          icon={revealed ? 'eyeOff' : 'eye'}
          label={revealed ? 'Hide' : 'Reveal'}
          onClick={() => setRevealed(!revealed)}
        />
        <IconButton icon="copy" label="Copy old password" onClick={onCopy} />
      </span>
    </li>
  );
}
