import { useSyncExternalStore } from 'react';

/** Chrome's install prompt event (not yet in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

let waiting: ServiceWorker | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let updateRequested = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Register the offline service worker (production builds only) and listen for
 * the browser's install prompt. A new version never reloads the page by
 * itself: the app offers it, and the user decides when.
 */
export function registerPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    emit();
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for an update the user asked for, not the first install.
    if (updateRequested) location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        const offer = (worker: ServiceWorker | null) => {
          if (worker && navigator.serviceWorker.controller) {
            waiting = worker;
            emit();
          }
        };
        offer(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed') offer(worker);
          });
        });
        // A long-open tab still hears about new versions.
        setInterval(() => void registration.update(), 60 * 60 * 1000);
      })
      .catch(() => {
        // Offline support is a bonus; the app works without it.
      });
  });
}

export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting !== null,
    () => false,
  );
}

export function applyUpdate(): void {
  if (!waiting) {
    location.reload();
    return;
  }
  updateRequested = true;
  waiting.postMessage('skip-waiting');
}

export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => installEvent !== null,
    () => false,
  );
}

export async function promptInstall(): Promise<void> {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  emit();
  await event.prompt();
}
