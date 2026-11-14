import { Injectable } from '@nestjs/common';
import { AuthorizationScope, Prisma, RoleGroup } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ForbiddenException, NotFoundException } from '../../shared/sdk/errors/domain.exception';
import { assertActive, identityInclude } from '../auth/identity.repository';
import { grantPermissions, resolveGrants } from './authorization';
export const reservedRoles = ['guest', 'student', 'teacher', 'admin', 'superadmin'];
@Injectable()
export class AuthorizationService {
  constructor(readonly prisma: PrismaService) {}
  async serialize(tx: Prisma.TransactionClient) {
    return tx.authorizationState.update({
      where: { id: 'default' },
      data: { version: { increment: 1 } },
    });
  }
  async actor(tx: Prisma.TransactionClient, id: string, permission?: string, courseId?: string) {
    const user = await tx.user.findUnique({ where: { id }, include: identityInclude });
    if (!user) throw new NotFoundException('User');
    assertActive(user);
    const grants = resolveGrants(user),
      permissions = grantPermissions(grants, courseId, user.id);
    if (permission && (!user.is_email_verified || !permissions.includes(permission)))
      throw new ForbiddenException('Current verified authorization required');
    return { ...user, grants, permissions };
  }
  async subject(tx: Prisma.TransactionClient, id: string) {
    const user = await tx.user.findUnique({ where: { id }, include: identityInclude });
    if (!user || user.deleted_at) throw new NotFoundException('User');
    if (!user.is_active) throw new ForbiddenException('Beneficiary account is inactive');
    // A manager must be able to restore an active account whose last role was revoked.
    return { ...user, grants: resolveGrants(user) };
  }
  async scope(
    tx: Prisma.TransactionClient,
    type: AuthorizationScope,
    id?: string,
    userId?: string,
  ) {
    if (type === 'SYSTEM') {
      if (id) throw new ForbiddenException('SYSTEM scope has no resource ID');
      return '';
    }
    if (!id) throw new ForbiddenException('Resource scope ID required');
    if (type === 'SELF' && id !== userId)
      throw new ForbiddenException('SELF scope must identify the beneficiary');
    if (type === 'COURSE' && !(await tx.course.findFirst({ where: { id, deleted_at: null } })))
      throw new NotFoundException('Course');
    return id;
  }
  async delegate(
    tx: Prisma.TransactionClient,
    actorId: string,
    permissions: string[],
    group: RoleGroup,
    scopeType: AuthorizationScope,
    scopeId: string,
    expiresAt?: Date,
    definitionOnly = false,
  ) {
    const actor = await this.actor(
      tx,
      actorId,
      'roles:delegate',
      scopeType === 'COURSE' ? scopeId : undefined,
    );
    if (!actor.grants.some((g) => g.group === 'MANAGER'))
      throw new ForbiddenException('Manager delegation required');
    if (actor.grants.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM')) return;
    if (permissions.some((p) => !actor.permissions.includes(p)))
      throw new ForbiddenException('Delegation cannot exceed current operational authority');
    const policies = await tx.roleDelegationPolicy.findMany({
      where: {
        user_id: actorId,
        revoked_at: null,
        OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
      },
      include: { permission: true },
    });
    for (const permission of permissions)
      if (
        !policies.some(
          (p) =>
            p.permission.name === permission &&
            p.allowed_groups.includes(group) &&
            (p.scope_type === 'SYSTEM' || (p.scope_type === scopeType && p.scope_id === scopeId)) &&
            (!p.expires_at || definitionOnly || (!!expiresAt && expiresAt <= p.expires_at)),
        )
      )
        throw new ForbiddenException(
          'Permission, group, scope or expiration exceeds explicit delegation policy',
        );
  }
}
