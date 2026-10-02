import type { ItemType, Vault, VaultItem } from '@passvaultify/core';
import {
  Avatar,
  Button,
  DataChip,
  Dialog,
  Fingerprint,
  Icon,
  IconButton,
  useToast,
  type IconName,
} from '@passvaultify/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppActions } from './App';
import { GeneratorDialog } from './GeneratorDialog';
import { ItemDetail } from './ItemDetail';
import { useAutoLockRemaining, useRings } from './hooks';
import { ItemForm, type ItemValues } from './ItemForm';
import {
  avatarSeed,
  byTitle,
  filterLabel,
  matchesFilter,
  matchesQuery,
  reuseIndex,
  sameFilter,
  subtitle,
  type Filter,
} from './model';
import { Brand } from './Onboarding';
import type { Profile, ThemeSetting } from './profile';
import { SettingsDialog } from './SettingsDialog';
import { ThemeToggle } from './ThemeToggle';

type Pane = { mode: 'view' } | { mode: 'edit'; id: string } | { mode: 'new'; type: ItemType };

export interface VaultAppProps {
  vault: Vault;
  profile: Profile;
  demo: boolean;
  actions: AppActions;
}

export function VaultApp({ vault, profile, demo, actions }: VaultAppProps) {
  const toast = useToast();
  // The vault is a mutable object; bump this after each write so React re-reads it.
  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  // Open on the first item, so the detail pane isn't empty on a wide screen.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => vault.list().sort(byTitle)[0]?.id ?? null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const [pane, setPane] = useState<Pane>({ mode: 'view' });
  /** On narrow screens the list and the detail take turns. */
  const [showDetail, setShowDetail] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<VaultItem | 'all' | null>(null);

  // "/" focuses search, as on most tools people already use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, [contenteditable="true"]');
      // Not while a dialog is open: search sits behind it.
      const modal = document.querySelector('[role="dialog"]');
      if (e.key === '/' && !typing && !modal && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const data = useMemo(() => {
    const active = vault.list();
    const trash = vault.trash();
    return {
      active,
      trash,
      tags: vault.tags(),
      reuse: reuseIndex(active),
      counts: {
        all: active.length,
        favorites: active.filter((i) => i.data.favorite).length,
        login: active.filter((i) => i.data.type === 'login').length,
        note: active.filter((i) => i.data.type === 'note').length,
        trash: trash.length,
      },
    };
    // `revision` is the signal that the vault's contents changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, revision]);

  const visible = useMemo(() => {
    const source = filter.kind === 'trash' ? data.trash : data.active;
    const found = source.filter((i) => matchesFilter(i, filter) && matchesQuery(i, query));
    return filter.kind === 'trash' ? found : found.sort(byTitle);
  }, [data, filter, query]);

  const selected = selectedId ? vault.get(selectedId) : undefined;
  const editing = pane.mode === 'edit' ? vault.get(pane.id) : undefined;

  const run = async (write: () => Promise<unknown>) => {
    await write();
    setRevision((r) => r + 1);
  };

  const open = (id: string) => {
    setSelectedId(id);
    setPane({ mode: 'view' });
    setShowDetail(true);
  };

  const chooseFilter = (next: Filter) => {
    setFilter(next);
    setPane({ mode: 'view' });
    setShowDetail(false);
    const first =
      next.kind === 'trash'
        ? data.trash[0]
        : data.active.filter((i) => matchesFilter(i, next)).sort(byTitle)[0];
    setSelectedId(first?.id ?? null);
  };

  /** After an item leaves the current view, select its neighbour. */
  const selectNeighbour = (id: string) => {
    const index = visible.findIndex((i) => i.id === id);
    const next = visible[index + 1] ?? visible[index - 1];
    setSelectedId(next && next.id !== id ? next.id : null);
  };

  const save = async (values: ItemValues) => {
    if (pane.mode === 'edit') {
      const before = vault.get(pane.id);
      await run(() =>
        vault.update(pane.id, {
          title: values.title,
          username: values.username,
          password: values.password,
          urls: values.urls,
          notes: values.notes,
          tags: values.tags,
          favorite: values.favorite,
        }),
      );
      const changed =
        before?.data.type === 'login' &&
        before.data.password &&
        before.data.password !== values.password;
      toast(changed ? 'Saved. The old password is in history.' : 'Saved');
      setPane({ mode: 'view' });
      return;
    }
    let created: VaultItem | undefined;
    await run(async () => {
      created = await vault.add(
        values.type === 'login'
          ? {
              type: 'login',
              title: values.title,
              username: values.username,
              password: values.password,
              urls: values.urls,
              notes: values.notes,
              tags: values.tags,
              favorite: values.favorite,
            }
          : {
              type: 'note',
              title: values.title,
              notes: values.notes,
              tags: values.tags,
              favorite: values.favorite,
            },
      );
    });
    if (created) {
      if (filter.kind === 'trash' || !matchesFilter(created, filter)) setFilter({ kind: 'all' });
      setQuery('');
      setSelectedId(created.id);
    }
    toast('Saved');
    setPane({ mode: 'view' });
  };

  const moveToTrash = async (item: VaultItem) => {
    selectNeighbour(item.id);
    setShowDetail(false);
    await run(() => vault.moveToTrash(item.id));
    toast(`Moved “${item.data.title}” to Trash`, {
      action: {
        label: 'Undo',
        onClick: () => {
          if (vault.locked) return;
          void run(() => vault.restore(item.id)).then(() => {
            if (filter.kind !== 'trash') setSelectedId(item.id);
          });
        },
      },
    });
  };

  const restore = async (item: VaultItem) => {
    selectNeighbour(item.id);
    await run(() => vault.restore(item.id));
    toast(`Restored “${item.data.title}”`, {
      action: {
        label: 'Show',
        onClick: () => (setFilter({ kind: 'all' }), setQuery(''), open(item.id)),
      },
    });
  };

  const purge = async (target: VaultItem | 'all') => {
    if (target === 'all') {
      const ids = data.trash.map((i) => i.id);
      await run(async () => {
        for (const id of ids) await vault.purge(id);
      });
      setSelectedId(null);
      toast(ids.length === 1 ? '1 item deleted forever' : `${ids.length} items deleted forever`);
    } else {
      selectNeighbour(target.id);
      await run(() => vault.purge(target.id));
      toast(`“${target.data.title}” deleted forever`);
    }
    setShowDetail(false);
  };

  const startNew = (type: ItemType) => {
    setPane({ mode: 'new', type });
    setShowDetail(true);
  };

  const navItems: { filter: Filter; icon: IconName; count: number }[] = [
    { filter: { kind: 'all' }, icon: 'list', count: data.counts.all },
    { filter: { kind: 'favorites' }, icon: 'star', count: data.counts.favorites },
    { filter: { kind: 'type', type: 'login' }, icon: 'key', count: data.counts.login },
    { filter: { kind: 'type', type: 'note' }, icon: 'note', count: data.counts.note },
  ];

  let detail: ReactNode;
  if (pane.mode === 'new' || (pane.mode === 'edit' && editing)) {
    detail = (
      <ItemForm
        key={pane.mode === 'edit' ? pane.id : `new-${pane.type}`}
        item={editing ?? null}
        reuse={data.reuse}
        onSave={save}
        onCancel={() => {
          setPane({ mode: 'view' });
          if (pane.mode === 'new') setShowDetail(false);
        }}
      />
    );
  } else if (selected && visible.some((i) => i.id === selected.id)) {
    detail = (
      <ItemDetail
        key={selected.id}
        item={selected}
        reusedBy={
          selected.data.type === 'login'
            ? (data.reuse.get(selected.data.password) ?? []).filter((o) => o.id !== selected.id)
            : []
        }
        onBack={() => setShowDetail(false)}
        onEdit={() => setPane({ mode: 'edit', id: selected.id })}
        onToggleFavorite={() =>
          void run(() => vault.update(selected.id, { favorite: !selected.data.favorite }))
        }
        onTrash={() => void moveToTrash(selected)}
        onRestore={() => void restore(selected)}
        onPurge={() => setPurgeTarget(selected)}
        onTag={(tag) => chooseFilter({ kind: 'tag', tag })}
        onOpenItem={(id) => {
          setFilter({ kind: 'all' });
          setQuery('');
          open(id);
        }}
      />
    );
  } else {
    detail = <EmptyDetail vault={vault} count={data.counts.all} trash={filter.kind === 'trash'} />;
  }

  const groups = groupByLetter(visible, filter.kind !== 'trash' && !query.trim());
  const searchCount = filter.kind === 'trash' ? data.counts.trash : data.counts.all;

  return (
    <div className="shell" data-view={showDetail ? 'detail' : 'list'} data-demo={demo || undefined}>
      {demo && (
        <div className="demo-bar" role="note">
          <span className="pv-label">Demo</span>
          <span>Sample data in memory. Nothing here is saved.</span>
          <button type="button" className="link" onClick={actions.exitDemo}>
            Create your own vault
          </button>
        </div>
      )}
      <aside className="side" aria-label="Vault navigation">
        <div className="side__brand">
          <Brand />
        </div>
        <Button
          variant="primary"
          icon="plus"
          className="side__new"
          onClick={() => startNew('login')}
        >
          New item
        </Button>
        <nav className="side__nav">
          <p className="pv-label side__group">Library</p>
          {navItems.map((n) => (
            <NavButton
              key={filterLabel(n.filter)}
              icon={n.icon}
              label={filterLabel(n.filter)}
              count={n.count}
              active={sameFilter(filter, n.filter)}
              onClick={() => chooseFilter(n.filter)}
            />
          ))}
          {data.tags.length > 0 && <p className="pv-label side__group">Tags</p>}
          {data.tags.map((tag) => (
            <NavButton
              key={tag}
              icon="tag"
              label={tag}
              count={data.active.filter((i) => i.data.tags.includes(tag)).length}
              active={filter.kind === 'tag' && filter.tag === tag}
              onClick={() => chooseFilter({ kind: 'tag', tag })}
            />
          ))}
          <div className="side__sep" />
          <NavButton
            icon="trash"
            label="Trash"
            count={data.counts.trash}
            active={filter.kind === 'trash'}
            onClick={() => chooseFilter({ kind: 'trash' })}
          />
          <NavButton icon="refresh" label="Generator" onClick={() => setGeneratorOpen(true)} />
          <NavButton icon="settings" label="Settings" onClick={() => setSettingsOpen(true)} />
        </nav>
        <VaultStatus
          vault={vault}
          profile={profile}
          demo={demo}
          onLock={actions.lock}
          onTheme={actions.changeTheme}
        />
      </aside>

      <section className="list-pane" aria-label={filterLabel(filter)}>
        <div className="list-head">
          <div className="list-head__top only-narrow">
            <Brand />
            <ThemeToggle value={profile.theme} onChange={actions.changeTheme} />
          </div>
          <div className="list-head__title">
            <h1 className="pv-display">{filterLabel(filter)}</h1>
            <span className="list-head__count pv-num">{visible.length}</span>
          </div>
          <label className="search">
            <Icon name="search" />
            <span className="pv-sr">Search</span>
            <input
              ref={searchRef}
              type="search"
              placeholder={searchPlaceholder(searchCount)}
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
            />
            {!query && <kbd className="pv-kbd">/</kbd>}
          </label>
          <div className="chips only-narrow" role="group" aria-label="Filter">
            {[
              ...navItems.map((n) => n.filter),
              { kind: 'trash' } as Filter,
              ...data.tags.map((tag): Filter => ({ kind: 'tag', tag })),
            ].map((f) => (
              <button
                key={filterLabel(f)}
                type="button"
                className="chip-filter"
                aria-pressed={sameFilter(filter, f)}
                onClick={() => chooseFilter(f)}
              >
                {filterLabel(f)}
              </button>
            ))}
          </div>
          {filter.kind === 'trash' && data.trash.length > 0 && (
            <div className="trash-note">
              <span>Items here are deleted forever after 30 days.</span>
              <button
                type="button"
                className="link link--danger"
                onClick={() => setPurgeTarget('all')}
              >
                Empty Trash
              </button>
            </div>
          )}
        </div>
        {visible.length > 0 ? (
          <div className="items" role="list">
            {groups.map((group) => (
              <div key={group.key} className="items__group" role="presentation">
                {group.letter && (
                  <p className="items__letter pv-label" aria-hidden="true">
                    {group.letter}
                  </p>
                )}
                {group.items.map((item) => {
                  const reused =
                    item.data.type === 'login' &&
                    (data.reuse.get(item.data.password)?.length ?? 0) > 1;
                  return (
                    <div key={item.id} role="listitem">
                      <button
                        type="button"
                        className="item-row"
                        aria-current={
                          item.id === selectedId && pane.mode === 'view' ? 'true' : undefined
                        }
                        onClick={() => open(item.id)}
                      >
                        <Avatar title={item.data.title} seed={avatarSeed(item)} />
                        <span className="item-row__text">
                          <span className="item-row__title">{item.data.title}</span>
                          <span className="item-row__sub">{subtitle(item)}</span>
                        </span>
                        <span className="item-row__marks">
                          {reused && filter.kind !== 'trash' && (
                            <span
                              className="item-row__flag"
                              title="Reused password"
                              aria-label="Reused password"
                            />
                          )}
                          {item.data.favorite && (
                            <Icon name="star" className="item-row__fav" aria-label="Favorite" />
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <EmptyList filter={filter} query={query} onNew={() => startNew('login')} />
        )}
      </section>

      <section className="detail-pane" aria-label="Item">
        {detail}
      </section>

      <nav className="tabbar only-narrow" aria-label="Actions">
        <button type="button" className="tabbar__btn" onClick={() => setShowDetail(false)}>
          <Icon name="list" />
          Items
        </button>
        <button type="button" className="tabbar__btn" onClick={() => setGeneratorOpen(true)}>
          <Icon name="refresh" />
          Generate
        </button>
        <button
          type="button"
          className="tabbar__btn tabbar__btn--new"
          aria-label="New item"
          onClick={() => startNew('login')}
        >
          <Icon name="plus" />
        </button>
        <button type="button" className="tabbar__btn" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" />
          Settings
        </button>
        <button type="button" className="tabbar__btn" onClick={actions.lock}>
          <Icon name="lock" />
          Lock
        </button>
      </nav>

      <GeneratorDialog open={generatorOpen} onOpenChange={setGeneratorOpen} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        vault={vault}
        profile={profile}
        demo={demo}
        onProfile={actions.updateProfile}
        onDeleteVault={actions.deleteVault}
        onExitDemo={actions.exitDemo}
      />
      <Dialog
        open={purgeTarget !== null}
        onOpenChange={(o) => !o && setPurgeTarget(null)}
        title={purgeTarget === 'all' ? 'Empty Trash?' : 'Delete forever?'}
        description={
          purgeTarget === 'all'
            ? `${data.counts.trash === 1 ? 'The item' : `All ${data.counts.trash} items`} in Trash will be erased. This can’t be undone.`
            : `“${purgeTarget?.data.title ?? ''}” will be erased. This can’t be undone.`
        }
      >
        <div className="dialog-actions">
          <Button onClick={() => setPurgeTarget(null)}>Cancel</Button>
          <Button
            variant="danger"
            icon="trash"
            autoFocus
            onClick={() => {
              const target = purgeTarget;
              setPurgeTarget(null);
              if (target) void purge(target);
            }}
          >
            Delete forever
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function searchPlaceholder(count: number): string {
  return count === 1 ? 'Search 1 item' : `Search ${count} items`;
}

/** Split an alphabetical list into letter sections (numbers and symbols under #). */
function groupByLetter(
  items: VaultItem[],
  enabled: boolean,
): { key: string; letter: string | null; items: VaultItem[] }[] {
  if (!enabled) return [{ key: 'all', letter: null, items }];
  const groups: { key: string; letter: string | null; items: VaultItem[] }[] = [];
  for (const item of items) {
    const first = item.data.title.trim().charAt(0).toUpperCase();
    const letter = /\p{L}/u.test(first) ? first : '#';
    const last = groups.at(-1);
    if (last?.letter === letter) last.items.push(item);
    else groups.push({ key: letter, letter, items: [item] });
  }
  return groups;
}

/** Bottom of the sidebar: which vault is open, and when it will lock itself. */
function VaultStatus({
  vault,
  profile,
  demo,
  onLock,
  onTheme,
}: {
  vault: Vault;
  profile: Profile;
  demo: boolean;
  onLock: () => void;
  onTheme: (theme: ThemeSetting) => void;
}) {
  const rings = useRings(vault.header.fingerprint);
  return (
    <div className="status">
      <div className="status__id">
        {rings && <Fingerprint bytes={rings} size={38} glyph="none" />}
        <div className="status__text">
          <span className="status__name">{profile.vaultName}</span>
          <AutoLockReadout minutes={profile.autoLockMinutes} />
        </div>
        <IconButton icon="lock" label="Lock vault" onClick={onLock} />
      </div>
      <div className="status__row">
        <DataChip mode={demo ? 'local' : profile.storageMode} compact />
        <ThemeToggle value={profile.theme} onChange={onTheme} />
      </div>
    </div>
  );
}

function AutoLockReadout({ minutes }: { minutes: number }) {
  const remaining = useAutoLockRemaining(minutes);
  if (remaining === null) return <span className="status__lock">Auto-lock off</span>;
  const m = Math.floor(remaining / 60);
  const s = String(remaining % 60).padStart(2, '0');
  return (
    <span className="status__lock pv-num" data-soon={remaining <= 60 || undefined}>
      Locks in {m}:{s}
    </span>
  );
}

function NavButton({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="nav-btn"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
      <span className="nav-btn__label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-btn__count pv-num">{count}</span>}
    </button>
  );
}

function EmptyList({ filter, query, onNew }: { filter: Filter; query: string; onNew: () => void }) {
  if (query.trim()) {
    return (
      <div className="empty">
        <p className="empty__title">Nothing matches “{query.trim()}”</p>
        <p>Search covers titles, usernames, websites and tags. Never passwords or notes.</p>
      </div>
    );
  }
  switch (filter.kind) {
    case 'trash':
      return (
        <div className="empty">
          <p className="empty__title">Trash is empty</p>
          <p>Deleted items wait here for 30 days, in case you change your mind.</p>
        </div>
      );
    case 'favorites':
      return (
        <div className="empty">
          <p className="empty__title">No favorites yet</p>
          <p>Star the items you open most and they'll gather here.</p>
        </div>
      );
    default:
      return (
        <div className="empty">
          <p className="empty__title">Nothing here yet</p>
          <p>Add your first login. It's sealed before it's saved.</p>
          <Button variant="primary" icon="plus" onClick={onNew}>
            New item
          </Button>
        </div>
      );
  }
}

function EmptyDetail({ vault, count, trash }: { vault: Vault; count: number; trash: boolean }) {
  const rings = useRings(vault.header.fingerprint);
  return (
    <div className="empty empty--detail">
      {rings && (
        <span className="empty__dial">
          <Fingerprint bytes={rings} size={168} bezel glyph="none" />
        </span>
      )}
      <p className="empty__title">
        {trash ? 'Select an item to restore it' : count ? 'Select an item' : 'Your vault is ready'}
      </p>
      <p>
        {count
          ? `${count} ${count === 1 ? 'item' : 'items'}, each sealed with AES-256-GCM.`
          : 'Everything you add is sealed on this device first.'}
      </p>
      {!trash && (
        <p className="empty__keys">
          <kbd className="pv-kbd">/</kbd> to search
        </p>
      )}
    </div>
  );
}
