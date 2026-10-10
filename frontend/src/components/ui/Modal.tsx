import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

const sizeClasses = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: keyof typeof sizeClasses;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className = '',
  size = 'md',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
      className={`m-auto backdrop:bg-black/60 bg-zinc-900 border border-zinc-800 rounded-xl p-0 text-zinc-100 ${sizeClasses[size]} w-full shadow-2xl ${className}`}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="p-6">
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 rounded-lg hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </dialog>
  );
}
