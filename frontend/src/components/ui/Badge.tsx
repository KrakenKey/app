import type { ReactNode } from 'react';

const variantClasses = {
  success: 'bg-emerald-500/10 text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-400',
  danger: 'bg-red-500/10 text-red-400',
  info: 'bg-cyan-500/10 text-cyan-400',
  neutral: 'bg-zinc-500/10 text-zinc-400',
} as const;

const dotClasses = {
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-cyan-400',
  neutral: 'bg-zinc-400',
} as const;

interface BadgeProps {
  variant?: keyof typeof variantClasses;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

export function Badge({
  variant = 'neutral',
  children,
  dot = true,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[variant]}`} />
      )}
      {children}
    </span>
  );
}
