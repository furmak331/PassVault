import {
  crackSeconds,
  formatDuration,
  generatePassphrase,
  generatePin,
  generateRandom,
  levelForBits,
  type Generated,
  type StrengthLevel,
} from '@passvaultify/core';
import { Badge, Button, Dialog, SecretText, Segmented, Switch, type Tone } from '@passvaultify/ui';
import { useId, useState } from 'react';
import { useCopy } from './hooks';

type Mode = 'random' | 'passphrase' | 'pin';

export interface GeneratorOptions {
  mode: Mode;
  length: number;
  digits: boolean;
  symbols: boolean;
  avoidLookAlikes: boolean;
  words: number;
  separator: string;
  capitalize: boolean;
  number: boolean;
  pinLength: number;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  mode: 'random',
  length: 20,
  digits: true,
  symbols: true,
  avoidLookAlikes: true,
  words: 5,
  separator: '-',
  capitalize: false,
  number: false,
  pinLength: 6,
};

export function generate(o: GeneratorOptions): Generated {
  switch (o.mode) {
    case 'random':
      return generateRandom({
        length: o.length,
        digits: o.digits,
        symbols: o.symbols,
        avoidLookAlikes: o.avoidLookAlikes,
      });
    case 'passphrase':
      return generatePassphrase({
        words: o.words,
        separator: o.separator,
        capitalize: o.capitalize,
        number: o.number,
      });
    case 'pin':
      return generatePin(o.pinLength);
  }
}

const LEVELS: Record<StrengthLevel, { label: string; tone: Tone }> = {
  weak: { label: 'Weak', tone: 'danger' },
  fair: { label: 'Fair', tone: 'warn' },
  strong: { label: 'Strong', tone: 'ok' },
  'very-strong': { label: 'Very strong', tone: 'ok' },
  excellent: { label: 'Excellent', tone: 'ok' },
};

const MODES = [
  { value: 'random', label: 'Random' },
  { value: 'passphrase', label: 'Passphrase' },
  { value: 'pin', label: 'PIN' },
] as const;

const SEPARATORS = [
  { value: '-', label: 'Hyphen' },
  { value: '.', label: 'Period' },
  { value: '_', label: 'Underscore' },
  { value: ' ', label: 'Space' },
] as const;

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="slider">
      <label htmlFor={id} className="slider__label">
        {label}
        <output htmlFor={id}>{value}</output>
      </label>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        value={value}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export interface GeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, shows "Use password" and passes the value back, e.g. to an item form. */
  onUse?: (value: string) => void;
}

export function GeneratorDialog({ open, onOpenChange, onUse }: GeneratorDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Password generator"
      description="Generated on this device with the browser's cryptographic random number generator."
    >
      <Generator
        onUse={
          onUse &&
          ((value) => {
            onUse(value);
            onOpenChange(false);
          })
        }
      />
    </Dialog>
  );
}

function Generator({ onUse }: { onUse: ((value: string) => void) | undefined }) {
  const [options, setOptions] = useState(DEFAULT_GENERATOR);
  const [result, setResult] = useState(() => generate(DEFAULT_GENERATOR));
  const copy = useCopy();

  const set = (patch: Partial<GeneratorOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    setResult(generate(next));
  };

  const level = LEVELS[levelForBits(result.bits)];

  return (
    <div className="gen">
      <Segmented
        label="Kind"
        value={options.mode}
        options={MODES}
        onChange={(mode) => set({ mode })}
      />
      <div className="gen__out">
        <SecretText value={result.value} revealed size="lg" />
        <div className="gen__meta">
          <Badge tone={level.tone}>{level.label}</Badge>
          <span>{Math.round(result.bits)} bits</span>
          <span title="Average time at 10 billion guesses a second, a GPU rig against a fast-hashed leak">
            Cracked in {formatDuration(crackSeconds(result.bits))}
          </span>
        </div>
      </div>

      <div className="gen__opts">
        {options.mode === 'random' && (
          <>
            <Slider
              label="Length"
              value={options.length}
              min={8}
              max={64}
              onChange={(length) => set({ length })}
            />
            <Switch
              label="Digits"
              checked={options.digits}
              onChange={(digits) => set({ digits })}
            />
            <Switch
              label="Symbols"
              checked={options.symbols}
              onChange={(symbols) => set({ symbols })}
            />
            <Switch
              label="Avoid look-alikes (l, 1, O, 0)"
              checked={options.avoidLookAlikes}
              onChange={(avoidLookAlikes) => set({ avoidLookAlikes })}
            />
          </>
        )}
        {options.mode === 'passphrase' && (
          <>
            <Slider
              label="Words"
              value={options.words}
              min={3}
              max={10}
              onChange={(words) => set({ words })}
            />
            <Segmented
              label="Separator"
              value={options.separator}
              options={SEPARATORS}
              onChange={(separator) => set({ separator })}
            />
            <Switch
              label="Capitalize"
              checked={options.capitalize}
              onChange={(capitalize) => set({ capitalize })}
            />
            <Switch
              label="Add a number"
              checked={options.number}
              onChange={(number) => set({ number })}
            />
          </>
        )}
        {options.mode === 'pin' && (
          <Slider
            label="Digits"
            value={options.pinLength}
            min={4}
            max={12}
            onChange={(pinLength) => set({ pinLength })}
          />
        )}
      </div>

      <div className="dialog-actions">
        <Button icon="refresh" onClick={() => setResult(generate(options))}>
          Regenerate
        </Button>
        <Button icon="copy" onClick={() => copy(result.value, 'Password')}>
          Copy
        </Button>
        {onUse && (
          <Button variant="primary" icon="check" onClick={() => onUse(result.value)}>
            Use password
          </Button>
        )}
      </div>
    </div>
  );
}
