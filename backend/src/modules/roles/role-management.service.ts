import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService, reservedRoles } from './authorization.service';
import { ManagedRoleDto, AssignmentDto, DelegationPolicyDto } from './management.dto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../shared/sdk/errors/domain.exception';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import { auditContent } from '../courses/content-integrity';
@Injectable()
export class RoleManagementService {
  constructor(readonly auth: AuthorizationService) {}
  async roles(query: PaginationQueryDto) {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const [data, total] = await Promise.all([
      this.auth.prisma.role.findMany({
        where,
        include: {
          role_permissions: { include: { permission: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: { name: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.auth.prisma.role.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.limit);
  }
  async delegable(actorId: string, scopeType = 'SYSTEM', scopeId = '') {
    return this.auth.prisma.$transaction(async (tx) => {
      const actor = await this.auth.actor(
        tx,
        actorId,
        'roles:delegate',
        scopeType === 'COURSE' ? scopeId : undefined,
      );
      const all = await tx.permission.findMany({ orderBy: { name: 'asc' } });
      if (actor.grants.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM'))
        return { permissions: all, policies: [], root: true };
      const policies = await tx.roleDelegationPolicy.findMany({
        where: {
          user_id: actorId,
          revoked_at: null,
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        include: { permission: true },
      });
      return {
        permissions: all.filter(
          (p) =>
            actor.permissions.includes(p.name) && policies.some((d) => d.permission_id === p.id),
        ),
        policies,
        root: false,
      };
    });
  }
  private async candidate(
    tx: Prisma.TransactionClient,
    dto: ManagedRoleDto,
    actorId: string,
    id?: string,
  ) {
    const existing = id
      ? await tx.role.findUnique({ where: { id }, include: { role_permissions: true } })
      : null;
    if (id && !existing) throw new NotFoundException('Role');
    if (
      reservedRoles.includes((existing?.name ?? dto.name).toLowerCase()) ||
      reservedRoles.includes(dto.name.toLowerCase())
    )
      throw new ForbiddenException('Built-in roles are immutable; use scoped assignments');
    if (existing && dto.expectedRevision !== existing.revision)
      throw new ConflictException('Role revision changed; preview again');
    if (existing?.status === 'ARCHIVED') throw new ForbiddenException('Archived role is immutable');
    if (existing && (existing.group !== dto.group || existing.scope_type !== dto.scopeType))
      throw new ForbiddenException('Role group and scope type are immutable');
    if (dto.scopeType === 'SELF' && dto.group !== 'STUDENT')
      throw new ForbiddenException(
        'SELF scopes are limited to learner operations; staff require explicit COURSE or SYSTEM scope',
      );
    const permissions = await tx.permission.findMany({ where: { id: { in: dto.permissionIds } } });
    if (permissions.length !== dto.permissionIds.length) throw new NotFoundException('Permission');
    const scopeId = await this.auth.scope(tx, dto.scopeType, dto.scopeId, actorId);
    await this.auth.actor(
      tx,
      actorId,
      'roles:manage',
      dto.scopeType === 'COURSE' ? scopeId : undefined,
    );
    await this.auth.delegate(
      tx,
      actorId,
      permissions.map((p) => p.name),
      dto.group,
      dto.scopeType,
      scopeId,
      undefined,
      true,
    );
    if (dto.group !== 'MANAGER') {
      const reference = await tx.role.findUniqueOrThrow({
        where: { name: dto.group === 'TEACHER' ? 'teacher' : 'student' },
        include: { role_permissions: true },
      });
      if (
        permissions.some((p) => !reference.role_permissions.some((r) => r.permission_id === p.id))
      )
        throw new ForbiddenException('Non-manager roles cannot contain administrative permissions');
    }
    const assignments = id
      ? await tx.userRoleAssignment.findMany({
          where: {
            role_id: id,
            revoked_at: null,
            OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
          },
        })
      : [];
    if (id)
      for (const legacy of await tx.user.findMany({
        where: { role_id: id, rbac_migrated: false, deleted_at: null },
        select: { id: true },
      }))
        assignments.push({
          user_id: legacy.id,
          scope_type: 'SYSTEM',
          scope_id: '',
          expires_at: null,
        } as (typeof assignments)[number]);
    const old = existing?.role_permissions.map((p) => p.permission_id) ?? [];
    const added = dto.permissionIds.filter((p) => !old.includes(p)),
      removed = old.filter((p) => !dto.permissionIds.includes(p));
    if (dto.group === 'MANAGER' && assignments.length && (added.length || removed.length))
      throw new ForbiddenException(
        'Assigned manager role permissions are frozen; create a replacement role and obtain dual approval',
      );
    for (const a of assignments)
      await this.auth.delegate(
        tx,
        actorId,
        permissions.map((p) => p.name),
        dto.group,
        a.scope_type,
        a.scope_id,
        a.expires_at ?? undefined,
      );
    return {
      existing,
      added,
      removed,
      affectedUsers: new Set(assignments.map((a) => a.user_id)).size,
      scopeChanges: false,
      requiredApprovals: dto.group === 'MANAGER' ? 2 : 1,
      scopeId,
    };
  }
  async save(dto: ManagedRoleDto, actorId: string, id?: string, preview = false) {
    try {
      return await this.auth.prisma.$transaction(async (tx) => {
        if (!preview) await this.auth.serialize(tx);
        const info = await this.candidate(tx, dto, actorId, id);
        if (preview)
          return {
            permissionsAdded: info.added,
            permissionsRemoved: info.removed,
            affectedUsers: info.affectedUsers,
            scopeChanges: info.scopeChanges,
            requiredApprovals: info.requiredApprovals,
            revision: info.existing?.revision ?? 0,
          };
        const data = {
          name: dto.name,
          description: dto.description,
          group: dto.group,
          scope_type: dto.scopeType,
          status: dto.status,
          is_active: dto.status === 'ACTIVE',
        };
        const role = id
          ? await tx.role.update({ where: { id }, data: { ...data, revision: { increment: 1 } } })
          : await tx.role.create({ data });
        await tx.rolePermission.deleteMany({ where: { role_id: role.id } });
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permission_id) => ({ role_id: role.id, permission_id })),
        });
        await tx.auditLog.create({
          data: {
            user_id: actorId,
            action: id ? 'role.updated' : 'role.created',
            resource: 'role',
            resource_id: role.id,
            old_data: info.existing
              ? {
                  name: info.existing.name,
                  status: info.existing.status,
                  revision: info.existing.revision,
                  permissionIds: info.existing.role_permissions.map((p) => p.permission_id),
                }
              : Prisma.JsonNull,
            new_data: {
              name: role.name,
              group: role.group,
              scopeType: role.scope_type,
              status: role.status,
              revision: role.revision,
              permissionIds: dto.permissionIds,
            },
          },
        });
        if (id) {
          const assigned = await tx.userRoleAssignment.findMany({
            where: { role_id: id, revoked_at: null },
            select: { user_id: true },
            distinct: ['user_id'],
          });
          await tx.notification.createMany({
            data: assigned.map((a) => ({
              user_id: a.user_id,
              type: 'authorization',
              title: 'Quyền truy cập đã thay đổi',
              body: 'Vai trò của bạn đã được cập nhật. Quyền mới có hiệu lực ở yêu cầu tiếp theo.',
            })),
          });
        }
        return role;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Role name already exists');
      throw error;
    }
  }
  async grant(tx: Prisma.TransactionClient, dto: AssignmentDto, actorId: string, approved = false) {
    if (actorId === dto.userId) throw new ForbiddenException('Self-promotion is forbidden');
    const actor = await this.auth.actor(
      tx,
      actorId,
      'roles:assign',
      dto.scopeType === 'COURSE' ? dto.scopeId : undefined,
    );
    const target = await this.auth.subject(tx, dto.userId);
    const role = await tx.role.findUnique({
      where: { id: dto.roleId },
      include: { role_permissions: { include: { permission: true } } },
    });
    if (
      !role ||
      !role.is_active ||
      role.status !== 'ACTIVE' ||
      ['guest', 'superadmin'].includes(role.name)
    )
      throw new ForbiddenException('Role is not assignable through this workflow');
    const scopeId = await this.auth.scope(tx, dto.scopeType, dto.scopeId, dto.userId);
    if (!reservedRoles.includes(role.name) && role.scope_type !== dto.scopeType)
      throw new ForbiddenException('Assignment scope must match role definition');
    if (role.group !== 'STUDENT' && !approved)
      throw new ForbiddenException('Teacher and manager assignments require an approval request');
    if (role.group === 'STUDENT' && role.name !== 'student') {
      const baseline = await tx.role.findUniqueOrThrow({
        where: { name: 'student' },
        include: { role_permissions: true },
      });
      if (
        role.role_permissions.some(
          (p) => !baseline.role_permissions.some((b) => b.permission_id === p.permission_id),
        )
      )
        throw new ForbiddenException(
          'Legacy role requires reviewed classification before assignment',
        );
    }
    const expires = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expires && expires <= new Date())
      throw new ForbiddenException('Assignment expiration must be in the future');
    await this.auth.delegate(
      tx,
      actor.id,
      role.role_permissions.map((p) => p.permission.name),
      role.group,
      dto.scopeType,
      scopeId,
      expires,
    );
    if (!target.rbac_migrated) {
      await tx.userRoleAssignment.create({ data: { user_id: target.id, role_id: target.role_id } });
      await tx.user.update({ where: { id: target.id }, data: { rbac_migrated: true } });
    }
    const existing = await tx.userRoleAssignment.findFirst({
      where: {
        user_id: target.id,
        role_id: role.id,
        scope_type: dto.scopeType,
        scope_id: scopeId,
        revoked_at: null,
      },
    });
    if (existing && (!existing.expires_at || existing.expires_at > new Date()))
      throw new ConflictException('Active assignment already exists');
    if (existing)
      await tx.userRoleAssignment.update({
        where: { id: existing.id },
        data: { revoked_at: new Date() },
      });
    const assignment = await tx.userRoleAssignment.create({
      data: {
        user_id: target.id,
        role_id: role.id,
        assigned_by: actorId,
        scope_type: dto.scopeType,
        scope_id: scopeId,
        expires_at: expires,
      },
    });
    await auditContent(tx, 'role.assigned', actorId, 'role_assignment', assignment.id);
    await tx.notification.create({
      data: {
        user_id: target.id,
        type: 'authorization',
        title: 'Bạn được cấp vai trò mới',
        body: `Vai trò ${role.name} đã được cấp trong phạm vi ${dto.scopeType}.`,
      },
    });
    return assignment;
  }
  async assign(dto: AssignmentDto, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      return this.grant(tx, dto, actorId);
    });
  }
  async revoke(id: string, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const assignment = await tx.userRoleAssignment.findUnique({
        where: { id },
        include: { role: { include: { role_permissions: { include: { permission: true } } } } },
      });
      if (!assignment) throw new NotFoundException('Assignment');
      if (assignment.user_id === actorId || assignment.role.name === 'superadmin')
        throw new ForbiddenException(
          'Self-removal and protected administrator removal require recovery procedure',
        );
      await this.auth.actor(
        tx,
        actorId,
        'roles:assign',
        assignment.scope_type === 'COURSE' ? assignment.scope_id : undefined,
      );
      await this.auth.delegate(
        tx,
        actorId,
        assignment.role.role_permissions.map((p) => p.permission.name),
        assignment.role.group,
        assignment.scope_type,
        assignment.scope_id,
        assignment.expires_at ?? undefined,
      );
      if (assignment.revoked_at) return assignment;
      const result = await tx.userRoleAssignment.update({
        where: { id },
        data: { revoked_at: new Date() },
      });
      await auditContent(tx, 'role.revoked', actorId, 'role_assignment', id);
      await tx.notification.create({
        data: {
          user_id: assignment.user_id,
          type: 'authorization',
          title: 'Vai trò đã được thu hồi',
          body: 'Một phân quyền của bạn đã được thu hồi. Thay đổi có hiệu lực ngay.',
        },
      });
      return result;
    });
  }
  async policies(actorId: string) {
    return this.auth.prisma.roleDelegationPolicy.findMany({
      where: { user_id: actorId },
      include: { permission: true },
      orderBy: { created_at: 'desc' },
    });
  }
  async policy(dto: DelegationPolicyDto, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const actor = await this.auth.actor(tx, actorId, 'roles:delegate');
      if (
        !actor.grants.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM') ||
        actorId === dto.userId
      )
        throw new ForbiddenException(
          'Independent protected administrator must establish delegation policy',
        );
      const target = await this.auth.subject(tx, dto.userId);
      if (!target.grants.some((g) => g.group === 'MANAGER'))
        throw new ForbiddenException('Delegate must already hold an approved manager role');
      const scopeId = await this.auth.scope(tx, dto.scopeType, dto.scopeId, dto.userId);
      if (
        (await tx.permission.count({ where: { id: { in: dto.permissionIds } } })) !==
        dto.permissionIds.length
      )
        throw new NotFoundException('Permission');
      const expires = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
      if (expires && expires <= new Date())
        throw new ForbiddenException('Policy expiration must be in the future');
      const result = await tx.roleDelegationPolicy.createMany({
        data: dto.permissionIds.map((permission_id) => ({
          user_id: dto.userId,
          permission_id,
          scope_type: dto.scopeType,
          scope_id: scopeId,
          allowed_groups: dto.allowedGroups,
          expires_at: expires,
        })),
      });
      await auditContent(tx, 'delegation.granted', actorId, 'identity', dto.userId);
      await tx.notification.create({
        data: {
          user_id: dto.userId,
          type: 'authorization',
          title: 'Cập nhật quyền ủy quyền',
          body: 'Chính sách ủy quyền có phạm vi đã được cập nhật. Chính sách này không tự cấp thêm quyền thực hiện.',
        },
      });
      return result;
    });
  }
  async revokePolicy(id: string, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const actor = await this.auth.actor(tx, actorId, 'roles:delegate');
      if (!actor.grants.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM'))
        throw new ForbiddenException('Protected administrator required');
      const row = await tx.roleDelegationPolicy.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Delegation');
      await auditContent(tx, 'delegation.revoked', actorId, 'delegation', id);
      return tx.roleDelegationPolicy.update({ where: { id }, data: { revoked_at: new Date() } });
    });
  }
}
