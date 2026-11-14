import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '../../shared/sdk/errors/domain.exception';
import { Role } from '../../shared/constants/roles.constant';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './role.dto';
import { AuthorizationService } from './authorization.service';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}
  async findAll(query: PaginationQueryDto) {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.role.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.role.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.limit);
  }
  async findById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { role_permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('Role', id);
    return role;
  }
  private reserved(name: string) {
    return (Object.values(Role) as string[]).includes(name);
  }
  async create(dto: CreateRoleDto, actorId: string) {
    if (this.reserved(dto.name))
      throw new ForbiddenException('Built-in role identifiers are reserved');
    return this.mutate(async (tx) => {
      await this.authorization.actor(tx, actorId, 'roles:delegate');
      const role = await tx.role.create({
        data: { name: dto.name, description: dto.description, is_default: false, group: 'MANAGER' },
      });
      await AuditService.record(tx, 'role.created', actorId, role.id);
      return role;
    });
  }
  async update(id: string, dto: UpdateRoleDto, actorId: string) {
    return this.mutate(async (tx) => {
      await this.authorization.actor(tx, actorId, 'roles:delegate');
      const role = await tx.role.update({
        where: { id },
        data: { updated_at: new Date(), revision: { increment: 1 } },
      });
      if (this.reserved(role.name) || (dto.name && this.reserved(dto.name)))
        throw new ForbiddenException('Built-in roles cannot be modified');
      const updated = await tx.role.update({
        where: { id },
        data: { name: dto.name, description: dto.description },
      });
      await AuditService.record(tx, 'role.updated', actorId, id);
      return updated;
    });
  }
  async delete(id: string, actorId: string): Promise<void> {
    await this.mutate(async (tx) => {
      await this.authorization.actor(tx, actorId, 'roles:delegate');
      const role = await tx.role.update({ where: { id }, data: { updated_at: new Date() } });
      if (this.reserved(role.name))
        throw new ForbiddenException('Built-in roles cannot be deleted');
      if (await tx.user.count({ where: { role_id: id } }))
        throw new ConflictException('Role is assigned to users');
      await tx.role.update({
        where: { id },
        data: { status: 'ARCHIVED', is_active: false, revision: { increment: 1 } },
      });
      await AuditService.record(tx, 'role.deleted', actorId, id);
    });
  }
  async permissions(id: string) {
    return (await this.findById(id)).role_permissions.map((rp) => rp.permission);
  }
  async assignPermissions(id: string, permissionIds: string[], actorId: string, remove = false) {
    return this.mutate(async (tx) => {
      const role = await tx.role.update({
        where: { id },
        data: { updated_at: new Date(), revision: { increment: 1 } },
      });
      if (role.name === Role.SUPERADMIN || role.name === Role.GUEST)
        throw new ForbiddenException(
          'Reserved role permissions are managed through reviewed seed changes',
        );
      const count = await tx.permission.count({ where: { id: { in: permissionIds } } });
      if (count !== permissionIds.length) throw new NotFoundException('Permission');
      if (this.reserved(role.name))
        throw new ForbiddenException('Built-in permissions are managed through reviewed seeds');
      if (
        (await tx.userRoleAssignment.count({ where: { role_id: id, revoked_at: null } })) ||
        (await tx.user.count({ where: { role_id: id, rbac_migrated: false } }))
      )
        throw new ForbiddenException(
          'Assigned manager role is frozen; use replacement and approval',
        );
      const permissions = await tx.permission.findMany({ where: { id: { in: permissionIds } } });
      await this.authorization.delegate(
        tx,
        actorId,
        permissions.map((p) => p.name),
        role.group,
        role.scope_type,
        '',
      );
      if (remove) {
        await tx.rolePermission.deleteMany({
          where: { role_id: id, permission_id: { in: permissionIds } },
        });
      } else {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permission_id) => ({ role_id: id, permission_id })),
          skipDuplicates: true,
        });
      }
      await AuditService.record(
        tx,
        remove ? 'role.permissions_removed' : 'role.permissions_assigned',
        actorId,
        id,
      );
      return tx.rolePermission.findMany({ where: { role_id: id }, include: { permission: true } });
    });
  }
  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.authorization.serialize(tx);
        return fn(tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('Role already exists');
        if (error.code === 'P2025') throw new NotFoundException('Role');
        if (error.code === 'P2003') throw new ConflictException('Role is still in use');
      }
      throw error;
    }
  }
}
