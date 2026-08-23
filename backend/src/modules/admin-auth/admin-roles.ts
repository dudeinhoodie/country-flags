import { SetMetadata } from "@nestjs/common";
import { AdminRole } from "@prisma/client";

export const ADMIN_ROLE_KEY = "adminRequiredRole";

// Roles form a strict ladder (ADR-014 / product spec §10.1); a higher role
// can do everything a lower one can.
const ROLE_RANK: Record<AdminRole, number> = {
  [AdminRole.VIEWER]: 0,
  [AdminRole.EDITOR]: 1,
  [AdminRole.PUBLISHER]: 2,
  [AdminRole.ADMIN]: 3,
};

export function roleSatisfies(actual: AdminRole, required: AdminRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const RequireAdminRole = (
  role: AdminRole,
): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ROLE_KEY, role);
