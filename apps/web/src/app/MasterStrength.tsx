import {
  estimateMasterPassword,
  formatDuration,
  MIN_MASTER_LENGTH,
  type MasterPasswordStrength,
} from '@passvaultify/core';
import { Meter } from '@passvaultify/ui';
import { useEffect, useState } from 'react';

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

export interface MasterStrength {
  /** Latest estimate. May be for an earlier keystroke while the next one runs. */
  strength: MasterPasswordStrength | null;
  /** Whether `strength` is for the password as typed now. */
  current: boolean;
}

/** Estimate a master password as it's typed, debounced so typing stays smooth. */
export function useMasterStrength(password: string, userInputs: string[]): MasterStrength {
  const [result, setResult] = useState<{
    password: string;
    strength: MasterPasswordStrength;
  } | null>(null);
  const inputsKey = userInputs.join('\n');
  useEffect(() => {
    if (!password) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void estimateMasterPassword(password, inputsKey.split('\n')).then((strength) => {
        if (!cancelled) setResult({ password, strength });
      });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, inputsKey]);
  if (!password) return { strength: null, current: true };
  return { strength: result?.strength ?? null, current: result?.password === password };
}

export function StrengthReadout({
  password,
  strength,
}: {
  password: string;
  strength: MasterPasswordStrength | null;
}) {
  const score = password && strength ? strength.score : -1;
  const tone = score >= 3 ? 'ok' : score === 2 ? 'warn' : 'danger';
  const label = password && strength ? LABELS[strength.score] : 'Not set';
  const tooShort = password.length > 0 && password.length < MIN_MASTER_LENGTH;
  const tip = tooShort
    ? `Use at least ${MIN_MASTER_LENGTH} characters.`
    : (strength?.warning ?? strength?.suggestions[0] ?? null);
  return (
    <div className="strength">
      <Meter value={score + 1} tone={tone} label={`Strength: ${label}`} />
      <div className="strength__row">
        <span className="strength__label" data-tone={score >= 0 ? tone : undefined}>
          {label}
        </span>
        {password && strength && (
          <span
            className="strength__time"
            title="Average time for an attacker with a stolen copy of the vault, guessing 1.5 million passwords a second"
          >
            Offline guessing: {formatDuration(strength.crackSeconds)}
          </span>
        )}
      </div>
      {password && tip && <p className="strength__tip">{tip}</p>}
    </div>
  );
}
