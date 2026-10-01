import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  icon?: IconName;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['pv-btn', `pv-btn--${variant}`, size === 'lg' && 'pv-btn--lg', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: icon-only buttons need an accessible name. */
  label: string;
}

export function IconButton({ icon, label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={['pv-btn', 'pv-btn--ghost', 'pv-btn--icon', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
