import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-zinc-600 mb-3">{icon}</div>}
      <h3 className="text-sm font-medium text-zinc-300 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-zinc-500 mb-4 max-w-sm">{description}</p>
      )}
      {action}
    </div>
  );
}
