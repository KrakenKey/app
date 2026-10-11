import { Badge, type BadgeVariant } from './Badge';

const planConfig: Record<string, { label: string; variant: BadgeVariant }> = {
  free: { label: 'Free', variant: 'neutral' },
  starter: { label: 'Starter', variant: 'accent' },
  team: { label: 'Team', variant: 'accent' },
  business: { label: 'Business', variant: 'accent' },
  enterprise: { label: 'Enterprise', variant: 'accent' },
};

interface PlanBadgeProps {
  plan?: string;
  className?: string;
}

export function PlanBadge({ plan = 'free', className }: PlanBadgeProps) {
  const config = planConfig[plan] ?? planConfig.free;
  return (
    <Badge variant={config.variant} dot={false} className={className}>
      {config.label}
    </Badge>
  );
}
