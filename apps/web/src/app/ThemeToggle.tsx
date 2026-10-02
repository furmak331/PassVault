import { Icon, type IconName } from '@passvaultify/ui';
import { useId } from 'react';
import type { ThemeSetting } from './profile';

const OPTIONS: { value: ThemeSetting; icon: IconName; label: string }[] = [
  { value: 'system', icon: 'contrast', label: 'Match system' },
  { value: 'porcelain', icon: 'sun', label: 'Light' },
  { value: 'graphite', icon: 'moon', label: 'Dark' },
];

/** Three-way theme switch, small enough to sit in any top bar. */
export function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemeSetting;
  onChange: (theme: ThemeSetting) => void;
}) {
  const name = useId();
  return (
    <fieldset className="theme-toggle">
      <legend className="pv-sr">Theme</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className="theme-toggle__opt" title={o.label}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <Icon name={o.icon} />
          <span className="pv-sr">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
