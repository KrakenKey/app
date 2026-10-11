import type { ReactNode } from 'react';

const variantClasses = {
  success: 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20',
  /** Healthy, nothing to do: neutral text, only the dot is green. */
  ok: 'bg-white/[0.04] text-zinc-300 ring-white/10',
  warning: 'bg-amber-400/10 text-amber-300 ring-amber-400/25',
  danger: 'bg-red-400/10 text-red-300 ring-red-400/25',
  info: 'bg-violet-400/10 text-violet-300 ring-violet-400/25',
  neutral: 'bg-white/[0.04] text-text-muted ring-white/10',
  accent: 'bg-cyan-400/10 text-cyan-300 ring-cyan-400/25',
} as const;

const dotClasses = {
  success: 'bg-emerald-400',
  ok: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-violet-400',
  neutral: 'bg-slate-400',
  accent: 'bg-cyan-400',
} as const;

export type BadgeVariant = keyof typeof variantClasses;

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}

export function Badge({
  variant = 'neutral',
  children,
  dot = true,
  className = '',
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${variantClasses[variant]} ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 shrink-0 rounded-full ${dotClasses[variant]}`}
        />
      )}
      {children}
    </span>
  );
}
