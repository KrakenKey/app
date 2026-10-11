import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export const fieldClass =
  'bg-bg border border-border-strong/70 rounded-lg px-3 py-2 text-sm text-text placeholder:text-zinc-500 hover:border-border-strong focus:border-accent/70 focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors duration-150 disabled:opacity-50';

export function Input({
  label,
  error,
  helpText,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`${fieldClass} ${error ? 'border-red-400/60' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
      {helpText && !error && (
        <p className="text-xs text-text-muted">{helpText}</p>
      )}
    </div>
  );
}
