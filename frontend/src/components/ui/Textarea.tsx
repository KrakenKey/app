import type { TextareaHTMLAttributes } from 'react';
import { fieldClass } from './Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export function Textarea({
  label,
  error,
  helpText,
  className = '',
  id,
  ...props
}: TextareaProps) {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={textareaId}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={`${fieldClass} resize-y min-h-[80px] ${error ? 'border-red-400/60' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
      {helpText && !error && (
        <p className="text-xs text-text-muted">{helpText}</p>
      )}
    </div>
  );
}
