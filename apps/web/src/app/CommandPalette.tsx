import type { VaultItem } from '@passvaultify/core';
import { Avatar, Icon, type IconName } from '@passvaultify/ui';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { avatarSeed, byTitle, matchesQuery, subtitle } from './model';

export interface PaletteCommand {
  id: string;
  section: 'Actions' | 'Go to' | 'Appearance' | 'Vault';
  label: string;
  icon: IconName;
  /** Extra words to match, e.g. "dark night" for a theme. */
  keywords?: string;
  /** Key hint shown on the right, e.g. "N". */
  shortcut?: string;
  run: () => void;
}

type Entry = { kind: 'item'; item: VaultItem } | { kind: 'command'; command: PaletteCommand };

const SECTIONS: PaletteCommand['section'][] = ['Actions', 'Go to', 'Vault', 'Appearance'];
const MAX_ITEMS = 8;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: VaultItem[];
  commands: PaletteCommand[];
  onOpenItem: (id: string) => void;
  onCopyPassword: (item: VaultItem) => void;
}

function commandMatches(command: PaletteCommand, words: string[]): boolean {
  const text = `${command.label} ${command.section} ${command.keywords ?? ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * 0: the name starts with what was typed, 1: the name contains every word,
 * 2: matched only through a keyword.
 */
function commandRank(command: PaletteCommand, words: string[], typed: string): number {
  const label = command.label.toLowerCase();
  if (typed && label.startsWith(typed)) return 0;
  return words.every((w) => label.includes(w)) ? 1 : 2;
}

/**
 * ⌘K: one box to find any item or run any action, entirely from the keyboard.
 * Search covers titles, usernames, sites and tags, never passwords or notes.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const { open, onOpenChange } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const close = (next: boolean) => {
    if (!next) {
      setQuery('');
      setActive(0);
    }
    onOpenChange(next);
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={close}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="pv-dialog__overlay palette__overlay" />
        <RadixDialog.Content className="palette" aria-describedby={undefined}>
          <RadixDialog.Title className="pv-sr">Command palette</RadixDialog.Title>
          <PaletteBody
            {...props}
            query={query}
            setQuery={(q) => {
              setQuery(q);
              setActive(0);
            }}
            active={active}
            setActive={setActive}
            close={() => close(false)}
          />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

function PaletteBody({
  items,
  commands,
  onOpenItem,
  onCopyPassword,
  query,
  setQuery,
  active,
  setActive,
  close,
}: CommandPaletteProps & {
  query: string;
  setQuery: (q: string) => void;
  active: number;
  setActive: (i: number) => void;
  close: () => void;
}) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  const groups = useMemo(() => {
    const found: { title: string; entries: Entry[] }[] = [];
    let itemGroup: { title: string; entries: Entry[] } | null = null;
    if (words.length) {
      const matches = items.filter((i) => matchesQuery(i, query)).sort(byTitle);
      if (matches.length) {
        itemGroup = {
          title: 'Items',
          entries: matches.slice(0, MAX_ITEMS).map((item) => ({ kind: 'item', item })),
        };
      }
    }
    // Sections are ordered by their best match, so typing the start of a
    // command's name ("imp", "lock") puts that command first. Items lead
    // unless a command name starts with the query.
    const typed = query.trim().toLowerCase();
    const ranked: { title: string; entries: Entry[]; best: number }[] = [];
    for (const section of SECTIONS) {
      const matched = commands
        .filter((c) => c.section === section && commandMatches(c, words))
        .map((command) => ({ command, rank: commandRank(command, words, typed) }))
        .sort((a, b) => a.rank - b.rank);
      if (matched.length) {
        ranked.push({
          title: section,
          entries: matched.map(({ command }): Entry => ({ kind: 'command', command })),
          best: matched[0]?.rank ?? 2,
        });
      }
    }
    if (itemGroup) ranked.push({ ...itemGroup, best: 0.5 });
    ranked.sort((a, b) => a.best - b.best);
    found.push(...ranked);
    return found;
    // `words` is derived from `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, commands, query]);

  const flat = groups.flatMap((g) => g.entries);
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, query]);

  const choose = (entry: Entry | undefined, copy = false) => {
    if (!entry) return;
    close();
    if (entry.kind === 'command') entry.command.run();
    else if (copy && entry.item.data.type === 'login') onCopyPassword(entry.item);
    else onOpenItem(entry.item.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive(flat.length ? (active + 1) % flat.length : 0);
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive(flat.length ? (active - 1 + flat.length) % flat.length : 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(current, e.shiftKey);
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const activeIndex = current ? flat.indexOf(current) : -1;
  let index = -1;

  return (
    <>
      <div className="palette__search">
        <Icon name="search" />
        <input
          className="palette__input"
          placeholder="Search items or type a command"
          autoFocus
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <kbd className="pv-kbd">esc</kbd>
      </div>
      <div className="palette__list" id={listId} role="listbox" ref={listRef}>
        {groups.length === 0 && <p className="palette__empty">Nothing matches “{query}”.</p>}
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title}>
            <p className="pv-label palette__section" aria-hidden="true">
              {group.title}
            </p>
            {group.entries.map((entry) => {
              index += 1;
              const i = index;
              const selected = i === activeIndex;
              return (
                <div
                  key={entry.kind === 'item' ? entry.item.id : entry.command.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  className="palette__option"
                  onMouseMove={() => !selected && setActive(i)}
                  onClick={() => choose(entry)}
                >
                  {entry.kind === 'item' ? (
                    <>
                      <Avatar
                        title={entry.item.data.title}
                        seed={avatarSeed(entry.item)}
                        size="sm"
                      />
                      <span className="palette__text">
                        <span className="palette__title">{entry.item.data.title}</span>
                        <span className="palette__sub">{subtitle(entry.item)}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="palette__icon">
                        <Icon name={entry.command.icon} />
                      </span>
                      <span className="palette__title">{entry.command.label}</span>
                      {entry.command.shortcut && (
                        <kbd className="pv-kbd palette__key">{entry.command.shortcut}</kbd>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="palette__foot" aria-hidden="true">
        <span>
          <kbd className="pv-kbd">↑</kbd>
          <kbd className="pv-kbd">↓</kbd> move
        </span>
        <span>
          <kbd className="pv-kbd">↵</kbd> open
        </span>
        <span>
          <kbd className="pv-kbd">⇧</kbd>
          <kbd className="pv-kbd">↵</kbd> copy password
        </span>
      </div>
    </>
  );
}
