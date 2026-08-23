import type { AdminUser } from "@prisma/client";

export function toAdminUserResponse(user: AdminUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
