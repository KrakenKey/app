import type { ButtonHTMLAttributes, ReactNode } from 'react';

const variantClasses = {
  primary: 'bg-accent text-zinc-950 hover:bg-accent-hover font-semibold',
  secondary:
    'bg-zinc-800 text-zinc-100 border border-zinc-700 hover:bg-zinc-700',
  danger:
    'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800',
  outline:
    'border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
} as const;

const sizeClasses = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
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
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
