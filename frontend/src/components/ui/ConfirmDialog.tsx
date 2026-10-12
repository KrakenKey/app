import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  /** Short question, e.g. "Revoke this certificate?" */
  title: string;
  /** What happens if the user goes ahead. */
  body?: ReactNode;
  /** The action verb, e.g. "Revoke certificate". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` (default) for destructive actions, `primary` otherwise. */
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation step for destructive actions, in place of `window.confirm()`.
 *
 * Focus starts on Cancel, so a stray Enter never confirms. Escape, the close
 * button and a click on the backdrop all cancel. Most call sites should use
 * the `useConfirm()` hook instead of rendering this directly.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Modal opens the <dialog> in its own effect, which runs before this one,
  // so Cancel is focusable by now. showModal() would otherwise focus the
  // header's close button.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button ref={cancelRef} type="button" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && (
        <div className="text-sm text-text-secondary leading-relaxed">
          {body}
        </div>
      )}
    </Modal>
  );
}
