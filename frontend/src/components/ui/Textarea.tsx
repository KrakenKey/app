import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helpText?: string;
}

export function Textarea({ label, error, helpText, className = '', id, ...props }: TextareaProps) {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={`bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 focus:outline-none transition-colors duration-150 resize-y min-h-[80px] disabled:opacity-50 ${error ? 'border-red-500/50' : ''} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {helpText && !error && <p className="text-xs text-zinc-500">{helpText}</p>}
    </div>
  );
}
