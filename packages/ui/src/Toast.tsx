import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ToastOptions {
  /** Optional action, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  /** How long it stays, in ms. */
  duration?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
  message: string;
}

const ToastContext = createContext<((message: string, options?: ToastOptions) => void) | null>(
  null,
);

/** Show short confirmations ("Copied", "Moved to Trash" with Undo). */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      // Keep the stack short: a new toast replaces all but the latest one.
      setToasts((t) => [...t.slice(-1), { id, message, ...options }]);
      setTimeout(() => dismiss(id), options.duration ?? (options.action ? 6000 : 3000));
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pv-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pv-toast">
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="pv-toast__action"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
