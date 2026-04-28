import type { WebUserRole } from '@/types';

export const ROLE_LEVEL: Record<WebUserRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
};

export function canAccessRole(current: WebUserRole | undefined, required: WebUserRole | undefined): boolean {
  if (!required) return true;
  if (!current) return false;
  return ROLE_LEVEL[current] >= ROLE_LEVEL[required];
}
