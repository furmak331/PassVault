import type { ItemType, Vault, VaultItem } from '@passvaultify/core';
import {
  Avatar,
  Button,
  DataChip,
  Dialog,
  Icon,
  IconButton,
  useToast,
  type IconName,
} from '@passvaultify/ui';
import { useMemo, useState, type ReactNode } from 'react';
import type { AppActions } from './App';
import { GeneratorDialog } from './GeneratorDialog';
import { ItemDetail } from './ItemDetail';
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
import type { Profile } from './profile';
import { SettingsDialog } from './SettingsDialog';

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>({ mode: 'view' });
  /** On narrow screens the list and the detail take turns. */
  const [showDetail, setShowDetail] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<VaultItem | 'all' | null>(null);

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
    detail = <EmptyDetail count={data.counts.all} trash={filter.kind === 'trash'} />;
  }

  const greeting = profile.name.trim() ? `Hi, ${profile.name.trim()}` : profile.vaultName;

  return (
    <div className="shell" data-view={showDetail ? 'detail' : 'list'}>
      {demo && (
        <div className="demo-bar" role="note">
          <span>
            <strong>Demo vault.</strong> Sample data, kept in memory. Nothing you do here is saved.
          </span>
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
          {data.tags.length > 0 && <p className="side__group">Tags</p>}
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
        </nav>
        <div className="side__foot">
          <NavButton icon="refresh" label="Generator" onClick={() => setGeneratorOpen(true)} />
          <NavButton icon="settings" label="Settings" onClick={() => setSettingsOpen(true)} />
          <NavButton icon="lock" label="Lock vault" onClick={actions.lock} />
          <div className="side__who">
            <DataChip mode={demo ? 'local' : profile.storageMode} />
          </div>
        </div>
      </aside>

      <section className="list-pane" aria-label={filterLabel(filter)}>
        <div className="topbar only-narrow">
          <Brand />
          <div className="topbar__tools">
            <IconButton icon="plus" label="New item" onClick={() => startNew('login')} />
            <IconButton
              icon="refresh"
              label="Password generator"
              onClick={() => setGeneratorOpen(true)}
            />
            <IconButton icon="settings" label="Settings" onClick={() => setSettingsOpen(true)} />
            <IconButton icon="lock" label="Lock vault" onClick={actions.lock} />
          </div>
        </div>
        <div className="list-head">
          <div className="list-head__title">
            <h1>{filterLabel(filter)}</h1>
            <span className="list-head__hello">{greeting}</span>
          </div>
          <label className="search">
            <Icon name="search" />
            <span className="pv-sr">Search</span>
            <input
              type="search"
              placeholder={searchPlaceholder(
                filter.kind === 'trash' ? data.counts.trash : data.counts.all,
              )}
              value={query}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
            />
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
          <ul className="items">
            {visible.map((item) => {
              const reused =
                item.data.type === 'login' && (data.reuse.get(item.data.password)?.length ?? 0) > 1;
              return (
                <li key={item.id}>
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
                    {reused && filter.kind !== 'trash' && (
                      <span
                        className="item-row__flag"
                        title="Reused password"
                        aria-label="Reused password"
                      />
                    )}
                    {item.data.favorite && filter.kind !== 'favorites' && (
                      <Icon name="star" className="item-row__fav" aria-label="Favorite" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyList filter={filter} query={query} onNew={() => startNew('login')} />
        )}
      </section>

      <section className="detail-pane" aria-label="Item">
        {detail}
      </section>

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
      {count !== undefined && count > 0 && <span className="nav-btn__count">{count}</span>}
    </button>
  );
}

function EmptyList({ filter, query, onNew }: { filter: Filter; query: string; onNew: () => void }) {
  if (query.trim()) {
    return (
      <div className="empty">
        <p className="empty__title">No matches for “{query.trim()}”</p>
        <p>Search looks at titles, usernames, websites and tags.</p>
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
          <p>Star the items you use most and they'll gather here.</p>
        </div>
      );
    default:
      return (
        <div className="empty">
          <p className="empty__title">Nothing here yet</p>
          <p>Add your first login. It's encrypted before it's saved.</p>
          <Button variant="primary" icon="plus" onClick={onNew}>
            New item
          </Button>
        </div>
      );
  }
}

function EmptyDetail({ count, trash }: { count: number; trash: boolean }) {
  return (
    <div className="empty empty--detail">
      <span className="empty__icon">
        <Icon name={trash ? 'trash' : 'shield'} />
      </span>
      <p className="empty__title">
        {trash ? 'Select an item to restore it' : count ? 'Select an item' : 'Your vault is ready'}
      </p>
      <p>
        {count
          ? `${count} ${count === 1 ? 'item' : 'items'}, encrypted with AES-256-GCM.`
          : 'Everything you add is encrypted on this device first.'}
      </p>
    </div>
  );
}
