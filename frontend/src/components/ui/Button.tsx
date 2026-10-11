import type { ButtonHTMLAttributes, ReactNode } from 'react';

const variantClasses = {
  primary:
    'bg-accent text-bg hover:bg-accent-hover font-semibold shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]',
  secondary:
    'bg-surface-elevated text-text border border-border-strong hover:bg-[#2e3c55] hover:border-[#4a5b78]',
  danger:
    'bg-red-500/10 text-red-300 border border-red-400/25 hover:bg-red-500/20',
  ghost: 'text-text-muted hover:text-text hover:bg-white/[0.05]',
  outline:
    'border border-border-strong text-text-secondary hover:bg-white/[0.04] hover:text-text',
} as const;

const sizeClasses = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
