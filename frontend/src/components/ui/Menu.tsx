import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Extra classes, e.g. `sm:hidden` for items shown inline on wide screens. */
  className?: string;
}

interface RowMenuProps {
  items: MenuItem[];
  /** Accessible name of the trigger, e.g. "More actions for example.com". */
  label?: string;
}

/**
 * Overflow menu for a table row. The popover is positioned with `fixed`, so
 * it is not clipped by a scrolling table container.
 */
export function RowMenu({ items, label = 'More actions' }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t))
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);

  if (items.length === 0) return null;

  const toggle = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-white/[0.06] transition-colors cursor-pointer ${open ? 'bg-white/[0.06] text-text' : ''}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 min-w-44 rounded-lg border border-border-strong bg-surface-elevated p-1 shadow-pop"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`${item.className ?? ''} flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                item.danger
                  ? 'text-red-300 hover:bg-red-500/10'
                  : 'text-text-secondary hover:bg-white/[0.06] hover:text-text'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
