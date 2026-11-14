import { Prisma } from '@prisma/client';
import { UnauthorizedException } from '../../shared/sdk/errors/domain.exception';
import { grantPermissions, resolveGrants } from '../roles/authorization';
export const identityInclude = {
  role: { include: { role_permissions: { include: { permission: true } } } },
  role_assignments: {
    where: { revoked_at: null },
    include: { role: { include: { role_permissions: { include: { permission: true } } } } },
  },
} satisfies Prisma.UserInclude;
export type Identity = Prisma.UserGetPayload<{ include: typeof identityInclude }>;
export async function lockIdentity(tx: Prisma.TransactionClient, id: string): Promise<Identity> {
  // No-op UPDATE obtains PostgreSQL's row lock, serializing session/credential writes.
  // Prisma has no SELECT FOR UPDATE API; this avoids raw SQL.
  try {
    return await tx.user.update({
      where: { id },
      data: { auth_version: { increment: 0 } },
      include: identityInclude,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
      throw new UnauthorizedException();
    throw error;
  }
}
export function assertActive(user: Identity): void {
  if (!user.is_active || user.deleted_at || !resolveGrants(user).length)
    throw new UnauthorizedException('Invalid credentials or inactive account');
}
export function profile(user: Identity) {
  const grants = resolveGrants(user);
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    avatarUrl: user.avatar_url,
    isActive: user.is_active,
    isEmailVerified: user.is_email_verified,
    role: { id: user.role.id, name: user.role.name },
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    permissions: grantPermissions(grants, undefined, user.id),
    roles: grants,
  };
}
export async function revokeIdentity(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.user.update({ where: { id }, data: { auth_version: { increment: 1 } } });
  await tx.refreshToken.updateMany({
    where: { user_id: id, is_revoked: false },
    data: { is_revoked: true },
  });
}
