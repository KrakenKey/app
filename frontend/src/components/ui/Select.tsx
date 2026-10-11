import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

const baseClass =
  'bg-bg border border-border-strong/70 rounded-lg text-text hover:border-border-strong focus:border-accent/70 focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors duration-150 disabled:opacity-50';

const sizeClasses = {
  sm: 'h-7 pl-2.5 pr-7 text-xs',
  md: 'h-9 pl-3 pr-8 text-sm',
} as const;

interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size'
> {
  label?: string;
  helpText?: string;
  size?: keyof typeof sizeClasses;
}

/**
 * A native select in the theme's field style: the OS arrow is replaced by a
 * chevron icon, so it matches Input instead of the browser's own control.
 */
export function Select({
  label,
  helpText,
  size = 'md',
  className = '',
  id,
  children,
  ...props
}: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');
  const select = (
    <div className={`relative ${label || helpText ? '' : 'inline-flex'}`}>
      <select
        id={selectId}
        className={`${baseClass} ${sizeClasses[size]} w-full appearance-none cursor-pointer disabled:cursor-not-allowed ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted ${size === 'sm' ? 'right-2 w-3.5 h-3.5' : 'right-2.5 w-4 h-4'}`}
      />
    </div>
  );

  if (!label && !helpText) return select;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      {select}
      {helpText && <p className="text-xs text-text-muted">{helpText}</p>}
    </div>
  );
}
