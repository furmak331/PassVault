import { Dialog } from '@passvaultify/ui';
import { modKey } from './files';

export const SHORTCUTS: { group: string; keys: string[][]; label: string }[] = [
  { group: 'Anywhere', keys: [['mod', 'K']], label: 'Command palette' },
  { group: 'Anywhere', keys: [['/']], label: 'Search' },
  { group: 'Anywhere', keys: [['N']], label: 'New item' },
  { group: 'Anywhere', keys: [['G']], label: 'Password generator' },
  { group: 'Anywhere', keys: [['L']], label: 'Lock the vault' },
  { group: 'Anywhere', keys: [['?']], label: 'This list' },
  { group: 'Selected item', keys: [['J'], ['↓']], label: 'Next item' },
  { group: 'Selected item', keys: [['K'], ['↑']], label: 'Previous item' },
  { group: 'Selected item', keys: [['C']], label: 'Copy password' },
  { group: 'Selected item', keys: [['U']], label: 'Copy username' },
  { group: 'Selected item', keys: [['E']], label: 'Edit' },
  { group: 'Selected item', keys: [['F']], label: 'Favorite or unfavorite' },
  { group: 'Selected item', keys: [['Delete']], label: 'Move to Trash (with Undo)' },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Single-key shortcuts work whenever you're not typing in a field."
    >
      {groups.map((group) => (
        <section key={group} className="keys">
          <h3 className="pv-label">{group}</h3>
          <dl>
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.label} className="keys__row">
                <dt>{s.label}</dt>
                <dd>
                  {s.keys.map((combo, i) => (
                    <span key={i} className="keys__combo">
                      {i > 0 && <span className="keys__or">or</span>}
                      {combo.map((k) => (
                        <kbd key={k} className="pv-kbd">
                          {k === 'mod' ? modKey() : k}
                        </kbd>
                      ))}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}
