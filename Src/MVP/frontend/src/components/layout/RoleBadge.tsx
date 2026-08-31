import type { UserRole } from '../../types';
import { cn } from '../../lib/utils';

interface RoleBadgeProps {
  role: UserRole;
  className?: string;
}

/** Maps each role to a colour that makes it visually distinct in the header. */
const ROLE_STYLES: Record<UserRole, string> = {
  DEVELOPER: 'bg-blue-100 text-blue-800',
  SECURITY_AUDITOR: 'bg-red-100 text-red-800',
  PROJECT_MANAGER: 'bg-purple-100 text-purple-800',
};

/** Shortened display labels so the badge fits in the header without overflow. */
const ROLE_LABELS: Record<UserRole, string> = {
  DEVELOPER: 'Dev',
  SECURITY_AUDITOR: 'Auditor',
  PROJECT_MANAGER: 'PM',
};

/**
 * Small pill badge shown in the app header next to the user's first name.
 * Gives at-a-glance confirmation of which role the user is operating under.
 */
export function RoleBadge({ role, className }: RoleBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold',
        ROLE_STYLES[role],
        className,
      )}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
