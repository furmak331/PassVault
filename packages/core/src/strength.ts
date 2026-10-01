import type { Score, ZxcvbnFactory } from '@zxcvbn-ts/core';

/**
 * Guesses per second an attacker could try against a stolen vault header.
 *
 * Order-of-magnitude estimate: a high-end GPU manages roughly 10^4 PBKDF2-SHA256
 * guesses per second at 600,000 iterations, so this models a rig of about a
 * hundred of them. It's deliberately pessimistic.
 */
export const MASTER_GUESSES_PER_SECOND = 1.5e6;
export const MIN_MASTER_LENGTH = 10;
export const MIN_MASTER_SCORE: Score = 3;

export interface MasterPasswordStrength {
  /** zxcvbn score: 0 (guessable) to 4 (very hard to guess). */
  score: Score;
  guessesLog10: number;
  /** Average seconds to guess it offline at MASTER_GUESSES_PER_SECOND. */
  crackSeconds: number;
  warning: string | null;
  suggestions: string[];
  /** Whether it meets the minimum for a master password. */
  acceptable: boolean;
}

let factory: Promise<ZxcvbnFactory> | null = null;

/**
 * zxcvbn's dictionaries are large, so they load on first use and the rest of
 * the app doesn't wait for them.
 */
function loadFactory(): Promise<ZxcvbnFactory> {
  factory ??= (async () => {
    const [{ ZxcvbnFactory }, common, en] = await Promise.all([
      import('@zxcvbn-ts/core'),
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ]);
    return new ZxcvbnFactory({
      translations: en.translations,
      graphs: common.adjacencyGraphs,
      dictionary: { ...common.dictionary, ...en.dictionary },
      useLevenshteinDistance: true,
    });
  })();
  return factory;
}

/**
 * Estimate how hard a master password is to guess. `userInputs` are words an
 * attacker would try first: the user's name, the vault name, their email.
 */
export async function estimateMasterPassword(
  password: string,
  userInputs: string[] = [],
): Promise<MasterPasswordStrength> {
  const zxcvbn = await loadFactory();
  const result = await zxcvbn.checkAsync(password, userInputs.filter(Boolean));
  const crackSeconds = 10 ** result.guessesLog10 / 2 / MASTER_GUESSES_PER_SECOND;
  return {
    score: result.score,
    guessesLog10: result.guessesLog10,
    crackSeconds,
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
    acceptable: password.length >= MIN_MASTER_LENGTH && result.score >= MIN_MASTER_SCORE,
  };
}
