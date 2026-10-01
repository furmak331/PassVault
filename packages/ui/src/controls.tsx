import {
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/** Text input with a label. Password fields warn when Caps Lock is on. */
export function TextField({
  label,
  hint,
  hideLabel,
  type = 'text',
  onKeyDown,
  onKeyUp,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(e.getModifierState('CapsLock'));
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pv-field">
      <label htmlFor={id} className={hideLabel ? 'pv-sr' : 'pv-field__label'}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className="pv-input"
        aria-describedby={hintId}
        onKeyDown={(e) => {
          if (type === 'password') checkCaps(e);
          onKeyDown?.(e);
        }}
        onKeyUp={(e) => {
          if (type === 'password') checkCaps(e);
          onKeyUp?.(e);
        }}
        {...rest}
      />
      {type === 'password' && capsLock && (
        <span className="pv-field__warn" role="status">
          Caps Lock is on
        </span>
      )}
      {hint && (
        <span id={hintId} className="pv-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
}

export function TextArea({ label, hint, className, ...rest }: TextAreaProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pv-field">
      <label htmlFor={id} className="pv-field__label">
        {label}
      </label>
      <textarea
        id={id}
        className={['pv-input', 'pv-textarea', className].filter(Boolean).join(' ')}
        aria-describedby={hintId}
        {...rest}
      />
      {hint && (
        <span id={hintId} className="pv-field__hint">
          {hint}
        </span>
      )}
    </div>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, onChange }: SwitchProps) {
  const id = useId();
  return (
    <span className="pv-switch">
      <span id={id}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="pv-switch__track"
        onClick={() => onChange(!checked)}
      >
        <span className="pv-switch__knob" />
      </button>
    </span>
  );
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="pv-seg">
      <legend className="pv-sr">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="pv-seg__opt">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
