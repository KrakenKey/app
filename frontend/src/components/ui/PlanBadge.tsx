import { normalizePlan, planLabel } from '@krakenkey/shared';
import { Badge } from './Badge';

interface PlanBadgeProps {
  plan?: string;
  className?: string;
}

export function PlanBadge({ plan = 'free', className }: PlanBadgeProps) {
  const id = normalizePlan(plan);
  return (
    <Badge
      variant={id === 'free' ? 'neutral' : 'accent'}
      dot={false}
      className={className}
    >
      {planLabel(id)}
    </Badge>
  );
}
