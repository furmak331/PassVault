import {
  DecryptionError,
  createVault,
  decryptItem,
  encryptItem,
  randomId,
  unlockVault,
  type Fingerprint,
  type VaultHeader,
} from '@passvaultify/core';
import { useCallback, useEffect, useState } from 'react';

export const DEMO_PASSWORD = 'correct horse battery staple';

export interface DemoItem {
  title: string;
  username: string;
  password: string;
}

const DEMO_ITEM: DemoItem = { title: 'GitHub', username: 'furmak331', password: 'k7#Tq-v9Rm!2xLp' };

export type DemoVault =
  | { status: 'creating' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      header: VaultHeader;
      fingerprint: Fingerprint;
      /** How long key derivation took on this device, in ms. */
      deriveMs: number;
      itemId: string;
      envelope: string;
      vaultKey: CryptoKey;
    };

/**
 * Creates a real vault in the browser with the production settings
 * (PBKDF2-SHA256, 600,000 iterations) and encrypts one demo item.
 */
export function useDemoVault() {
  const [vault, setVault] = useState<DemoVault>({ status: 'creating' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const started = performance.now();
      const created = await createVault(DEMO_PASSWORD);
      const deriveMs = performance.now() - started;
      const itemId = randomId();
      const envelope = await encryptItem(created.vaultKey, itemId, DEMO_ITEM);
      if (!cancelled) {
        setVault({
          status: 'ready',
          header: created.header,
          fingerprint: created.fingerprint,
          deriveMs,
          itemId,
          envelope,
          vaultKey: created.vaultKey,
        });
      }
    })().catch((err: unknown) => {
      if (!cancelled)
        setVault({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Try a password against the real vault header. Resolves to true on success. */
  const tryUnlock = useCallback(
    async (password: string): Promise<boolean> => {
      if (vault.status !== 'ready') return false;
      try {
        await unlockVault(password, vault.header);
        return true;
      } catch (err) {
        if (err instanceof DecryptionError) return false;
        throw err;
      }
    },
    [vault],
  );

  /** Decrypt the demo item with the vault key. */
  const decryptDemo = useCallback(async (): Promise<DemoItem | null> => {
    if (vault.status !== 'ready') return null;
    return decryptItem<DemoItem>(vault.vaultKey, vault.itemId, vault.envelope);
  }, [vault]);

  return { vault, tryUnlock, decryptDemo };
}
