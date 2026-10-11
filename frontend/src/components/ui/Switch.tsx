import type { ReactNode } from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible text after the track; also the accessible name. */
  label?: ReactNode;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  /** Lets a separate `<label htmlFor>` (a whole settings row) name it. */
  id?: string;
  'aria-describedby'?: string;
  className?: string;
}

/**
 * On/off control for a boolean setting. A native checkbox with
 * `role="switch"` over a styled track, so keyboard, focus and screen
 * readers behave like any other form control.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  'aria-label': ariaLabel,
  id,
  'aria-describedby': describedBy,
  className = '',
}: SwitchProps) {
  return (
    <label
      className={`relative inline-flex items-center gap-2 select-none ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    >
      {/* The real checkbox sits invisibly over the track, so it is what
          gets clicked, focused and read out. */}
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          id={id}
          checked={checked}
          aria-checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-[inherit] appearance-none opacity-0"
        />
        <span
          aria-hidden="true"
          className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
            checked ? 'bg-cyan-500/55' : 'bg-zinc-700'
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
            }`}
          />
        </span>
      </span>
      {label != null && <span className="text-sm text-zinc-300">{label}</span>}
    </label>
  );
}
