import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const sizeClasses = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
} as const;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  /** Pinned below the scrolling body, for the primary actions. */
  footer?: ReactNode;
  className?: string;
  size?: keyof typeof sizeClasses;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = '',
  size = 'md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title ? titleId : undefined}
      className={`m-auto backdrop:bg-[#050914]/75 backdrop:backdrop-blur-[2px] bg-surface border border-border-strong/80 rounded-xl p-0 text-text ${sizeClasses[size]} w-[calc(100%-2rem)] max-h-[calc(100dvh-3rem)] shadow-pop overflow-hidden open:flex flex-col ${className}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {title && (
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border-subtle shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="text-sm text-text-muted mt-1">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text transition-colors p-1 -mr-1 rounded-lg hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="px-6 py-5 overflow-y-auto min-h-0 flex-1">{children}</div>
      {footer && (
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border-subtle bg-bg/40 shrink-0">
          {footer}
        </div>
      )}
    </dialog>
  );
}
