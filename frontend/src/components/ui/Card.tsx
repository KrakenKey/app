import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
}

export function Card({ children, hover = false, className = '', ...props }: CardProps) {
  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-xl p-6 ${hover ? 'hover:border-zinc-700 transition-colors duration-150' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
