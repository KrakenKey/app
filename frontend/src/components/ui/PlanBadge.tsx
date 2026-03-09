import { Badge } from './Badge';

const planConfig: Record<
  string,
  { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' }
> = {
  free: { label: 'Free', variant: 'neutral' },
  starter: { label: 'Starter', variant: 'info' },
  team: { label: 'Team', variant: 'info' },
  business: { label: 'Business', variant: 'success' },
  enterprise: { label: 'Enterprise', variant: 'warning' },
};

interface PlanBadgeProps {
  plan?: string;
  className?: string;
}

export function PlanBadge({ plan = 'free', className }: PlanBadgeProps) {
  const config = planConfig[plan] ?? planConfig.free;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
