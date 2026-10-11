import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export interface ConfirmOptions {
  /** Short question, e.g. "Revoke this certificate?" */
  title: string;
  /** What happens if the user goes ahead. */
  body?: ReactNode;
  /** The action verb, e.g. "Revoke certificate". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

interface Pending {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
  /** Element that had focus when the dialog opened, restored on close. */
  returnFocus: HTMLElement | null;
}

/**
 * Hosts one ConfirmDialog for the whole app. Components ask for a decision
 * with `useConfirm()`, which resolves to true only when the user picks the
 * confirm button.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(confirmed);
    // The trigger may have lived in a row menu that has since closed.
    if (current.returnFocus?.isConnected) current.returnFocus.focus();
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    // A second request replaces an unanswered one, which counts as canceled.
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const active = document.activeElement;
      const next: Pending = {
        options,
        resolve,
        returnFocus: active instanceof HTMLElement ? active : null,
      };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  // Don't leave a caller waiting forever if the provider goes away.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          {...pending.options}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
