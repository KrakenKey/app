import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, description, icon, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-8">
      <div className="flex items-center gap-3">
        {icon && <div className="text-zinc-400">{icon}</div>}
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
          {description && <p className="text-sm text-zinc-500 mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
