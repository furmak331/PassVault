import {
  hostOf,
  normalizeTags,
  type ItemData,
  type ItemType,
  type VaultItem,
} from '@passvaultify/core';
import { Button, IconButton, Segmented, Switch, TextArea, TextField } from '@passvaultify/ui';
import { useState, type FormEvent } from 'react';
import { GeneratorDialog } from './GeneratorDialog';

export interface ItemValues {
  type: ItemType;
  title: string;
  username: string;
  password: string;
  urls: string[];
  notes: string;
  tags: string[];
  favorite: boolean;
}

export interface ItemFormProps {
  /** The item being edited, or null for a new one. */
  item: VaultItem | null;
  /** Logins by password, to warn about reuse as the user types. */
  reuse: Map<string, VaultItem[]>;
  onSave: (values: ItemValues) => Promise<void>;
  onCancel: () => void;
}

function initialValues(data: ItemData | undefined): ItemValues {
  return {
    type: data?.type ?? 'login',
    title: data?.title ?? '',
    username: data?.type === 'login' ? data.username : '',
    password: data?.type === 'login' ? data.password : '',
    urls: data?.type === 'login' && data.urls.length > 0 ? data.urls : [''],
    notes: data?.notes ?? '',
    tags: data?.tags ?? [],
    favorite: data?.favorite ?? false,
  };
}

/** "github.com" → "Github", for a login saved without a title. */
function titleFromUrl(url: string): string {
  const host = hostOf(url)?.replace(/^www\./, '');
  if (!host) return '';
  const name = host.split('.').slice(-2, -1)[0] ?? host;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const TYPES = [
  { value: 'login', label: 'Login' },
  { value: 'note', label: 'Secure note' },
] as const;

export function ItemForm({ item, reuse, onSave, onCancel }: ItemFormProps) {
  const [v, setV] = useState(() => initialValues(item?.data));
  const [tagText, setTagText] = useState(() => v.tags.join(', '));
  const [showPassword, setShowPassword] = useState(!item);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<ItemValues>) => setV((prev) => ({ ...prev, ...patch }));

  const login = v.type === 'login';
  const derivedTitle = login ? titleFromUrl(v.urls.find((u) => u.trim()) ?? '') : '';
  const title = v.title.trim() || derivedTitle;
  const reusedBy =
    login && v.password ? (reuse.get(v.password) ?? []).filter((o) => o.id !== item?.id) : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onSave({
        ...v,
        title,
        urls: v.urls.map((u) => u.trim()).filter(Boolean),
        tags: normalizeTags(tagText.split(/[,\s]+/).map((t) => t.replace(/^#/, ''))),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="detail item-form"
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !generatorOpen) onCancel();
      }}
    >
      <div className="detail__bar">
        <IconButton icon="back" label="Cancel" className="only-narrow" onClick={onCancel} />
        <span className="pv-label">{item ? 'Editing' : 'New item'}</span>
        <span className="detail__spacer" />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!title || busy}>
          Save
        </Button>
      </div>
      {/* The title echoes as you type, set the way it will appear. */}
      <h2 className="pv-display detail__title item-form__title" data-empty={!title || undefined}>
        {title || (login ? 'Untitled login' : 'Untitled note')}
      </h2>

      {!item && (
        <Segmented
          label="Item type"
          value={v.type}
          options={TYPES}
          onChange={(type) => set({ type })}
        />
      )}

      <TextField
        label="Title"
        autoFocus
        maxLength={120}
        placeholder={derivedTitle || (login ? 'e.g. GitHub' : 'e.g. Passport number')}
        value={v.title}
        onChange={(e) => set({ title: e.target.value })}
      />

      {login && (
        <>
          <TextField
            label="Username or email"
            autoComplete="off"
            spellCheck={false}
            value={v.username}
            onChange={(e) => set({ username: e.target.value })}
          />
          <div className="field-with-action">
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck={false}
              value={v.password}
              onChange={(e) => set({ password: e.target.value })}
              {...(reusedBy.length > 0
                ? { hint: `Also used by ${reusedBy.map((o) => o.data.title).join(', ')}` }
                : item?.data.type === 'login' &&
                    item.data.password &&
                    v.password !== item.data.password
                  ? { hint: 'The current password will be kept in password history.' }
                  : {})}
            />
            <div className="field-actions">
              <IconButton
                icon={showPassword ? 'eyeOff' : 'eye'}
                label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              />
              <Button icon="refresh" onClick={() => setGeneratorOpen(true)}>
                Generate
              </Button>
            </div>
          </div>
          <fieldset className="url-list">
            <legend className="pv-field__label">Websites</legend>
            {v.urls.map((url, i) => (
              <div key={i} className="url-list__row">
                <TextField
                  label={`Website ${i + 1}`}
                  hideLabel
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com"
                  spellCheck={false}
                  value={url}
                  onChange={(e) =>
                    set({ urls: v.urls.map((u, j) => (j === i ? e.target.value : u)) })
                  }
                />
                {v.urls.length > 1 && (
                  <IconButton
                    icon="close"
                    label={`Remove website ${i + 1}`}
                    onClick={() => set({ urls: v.urls.filter((_, j) => j !== i) })}
                  />
                )}
              </div>
            ))}
            <Button
              icon="plus"
              className="url-list__add"
              onClick={() => set({ urls: [...v.urls, ''] })}
            >
              Add website
            </Button>
          </fieldset>
        </>
      )}

      <TextArea
        label={login ? 'Notes' : 'Note'}
        rows={login ? 3 : 8}
        value={v.notes}
        onChange={(e) => set({ notes: e.target.value })}
      />
      <TextField
        label="Tags"
        hint="Separate with commas or spaces"
        placeholder="work, finance"
        spellCheck={false}
        value={tagText}
        onChange={(e) => setTagText(e.target.value)}
      />
      <Switch label="Favorite" checked={v.favorite} onChange={(favorite) => set({ favorite })} />

      <GeneratorDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        onUse={(password) => {
          set({ password });
          setShowPassword(true);
        }}
      />
    </form>
  );
}
