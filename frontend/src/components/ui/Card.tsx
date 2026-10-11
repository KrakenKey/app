import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hover?: boolean;
  /** Drop the default padding, for cards that hold a flush table or list. */
  flush?: boolean;
}

export function Card({
  children,
  hover = false,
  flush = false,
  className = '',
  ...props
}: CardProps) {
  // A caller that sets its own padding (p-0, p-4) replaces the default.
  const ownPadding = /(^|\s)p-\d/.test(className);
  return (
    <div
      className={`bg-surface border border-border rounded-xl shadow-card ${flush || ownPadding ? '' : 'p-5 sm:p-6'} ${hover ? 'hover:border-border-strong hover:bg-surface-hover transition-colors duration-150' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Title row for a flush card: title left, actions right, hairline below. */
export function CardHeader({
  title,
  description,
  actions,
  className = '',
}: CardHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border-subtle ${className}`}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && (
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
