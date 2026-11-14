import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaginatedResult } from '../../shared/sdk';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '../../shared/sdk/errors/domain.exception';
import { hashPassword } from '../../shared/utils/hash.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RequestUser } from '../../shared/sdk/auth/interfaces/request-user.interface';
import {
  identityInclude,
  lockIdentity,
  profile,
  revokeIdentity,
  Identity,
} from '../auth/identity.repository';
import { AuditService } from '../audit/audit.service';
import { UsersQueryDto } from './dto/users-query.dto';
import { AuthorizationService } from '../roles/authorization.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}
  async findAll(query: UsersQueryDto) {
    const where: Prisma.UserWhereInput = { deleted_at: null };
    if (query.status) where.is_active = query.status === 'active';
    if (query.roleId)
      where.AND = [
        {
          OR: [
            { rbac_migrated: false, role_id: query.roleId },
            {
              rbac_migrated: true,
              role_assignments: {
                some: {
                  role_id: query.roleId,
                  revoked_at: null,
                  OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
                  role: { is_active: true, status: 'ACTIVE' },
                },
              },
            },
          ],
        },
      ];
    if (query.search)
      where.OR = ['email', 'first_name', 'last_name'].map((key) => ({
        [key]: { contains: query.search, mode: 'insensitive' },
      }));
    const sort = ['email', 'first_name', 'last_name', 'created_at'].includes(query.sort ?? '')
      ? query.sort!
      : 'created_at';
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { [sort]: query.order },
        include: identityInclude,
      }),
      this.prisma.user.count({ where }),
    ]);
    return new PaginatedResult(users.map(profile), total, query.page, query.limit);
  }
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: identityInclude });
    if (!user || user.deleted_at) throw new NotFoundException('User', id);
    return profile(user);
  }
  private async assignable(tx: Prisma.TransactionClient, roleId: string, actor: RequestUser) {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: { role_permissions: { include: { permission: true } } },
    });
    if (!role || !role.is_active || role.name === 'guest')
      throw new NotFoundException('Active role', roleId);
    if (role.group !== 'STUDENT')
      throw new ForbiddenException('Staff appointments require an approval request');
    await this.authorization.delegate(
      tx,
      actor.id,
      role.role_permissions.map((p) => p.permission.name),
      role.group,
      'SYSTEM',
      '',
    );
    if (role.name === 'superadmin' || (role.name === 'admin' && actor.roleName !== 'superadmin'))
      throw new ForbiddenException('Privileged role assignment is restricted');
    if (
      actor.roleName !== 'superadmin' &&
      role.role_permissions.some((rp) => !actor.permissions.includes(rp.permission.name))
    )
      throw new ForbiddenException('Cannot assign permissions you do not possess');
    return role;
  }
  private protect(user: Identity, actor: RequestUser) {
    if (
      user.role.name === 'superadmin' ||
      (user.role.name === 'admin' && actor.roleName !== 'superadmin')
    )
      throw new ForbiddenException('Privileged account must use controlled administration');
  }
  async create(dto: CreateUserDto, actor: RequestUser) {
    const password_hash = await hashPassword(dto.password);
    return this.mutate(async (tx) => {
      await this.authorization.actor(tx, actor.id, 'users:create');
      await this.assignable(tx, dto.roleId, actor);
      const user = await tx.user.create({
        data: {
          email: dto.email.trim().toLowerCase(),
          password_hash,
          first_name: dto.firstName,
          last_name: dto.lastName,
          role_id: dto.roleId,
          rbac_migrated: true,
          role_assignments: { create: { role_id: dto.roleId, assigned_by: actor.id } },
        },
        include: identityInclude,
      });
      await AuditService.record(tx, 'user.created', actor.id, user.id);
      return profile(user);
    });
  }
  async update(id: string, dto: UpdateUserDto, actor: RequestUser) {
    return this.mutate(async (tx) => {
      await this.authorization.actor(tx, actor.id, 'users:update');
      const user = await lockIdentity(tx, id);
      if (user.deleted_at) throw new NotFoundException('User', id);
      this.protect(user, actor);
      if (id === actor.id && (dto.roleId !== undefined || dto.isActive !== undefined))
        throw new ForbiddenException('Cannot change your own role or activation');
      if (dto.roleId !== undefined) await this.assignable(tx, dto.roleId, actor);
      if (dto.roleId !== undefined) {
        await tx.userRoleAssignment.updateMany({
          where: { user_id: id, role_id: user.role_id, scope_type: 'SYSTEM', revoked_at: null },
          data: { revoked_at: new Date() },
        });
        await tx.userRoleAssignment.create({
          data: { user_id: id, role_id: dto.roleId, assigned_by: actor.id },
        });
      }
      const email = dto.email?.trim().toLowerCase();
      const emailChanged = email !== undefined && email !== user.email;
      const sensitive = emailChanged || dto.roleId !== undefined || dto.isActive !== undefined;
      if (sensitive) {
        await revokeIdentity(tx, id);
        await tx.credentialToken.updateMany({
          where: { user_id: id, consumed_at: null },
          data: { consumed_at: new Date() },
        });
      }
      const updated = await tx.user.update({
        where: { id },
        data: {
          first_name: dto.firstName,
          last_name: dto.lastName,
          email,
          avatar_url: dto.avatarUrl,
          is_active: dto.isActive,
          role_id: dto.roleId,
          ...(dto.roleId ? { rbac_migrated: true } : {}),
          ...(emailChanged ? { is_email_verified: false } : {}),
        },
        include: identityInclude,
      });
      await AuditService.record(
        tx,
        dto.isActive === false
          ? 'user.deactivated'
          : dto.roleId
            ? 'user.role_changed'
            : 'user.updated',
        actor.id,
        id,
      );
      if (dto.isActive !== undefined)
        await tx.notification.create({
          data: {
            user_id: id,
            type: 'account',
            title: 'Trạng thái tài khoản đã thay đổi',
            body: dto.isActive
              ? 'Tài khoản của bạn đã được kích hoạt.'
              : 'Tài khoản của bạn đã bị vô hiệu hóa. Liên hệ quản lý để được hỗ trợ.',
          },
        });
      return profile(updated);
    });
  }
  async delete(id: string, actor: RequestUser): Promise<void> {
    await this.mutate(async (tx) => {
      await this.authorization.actor(tx, actor.id, 'users:delete');
      const user = await lockIdentity(tx, id);
      this.protect(user, actor);
      if (id === actor.id)
        throw new ForbiddenException('Cannot delete your own administrative account');
      if (user.deleted_at) throw new NotFoundException('User', id);
      await revokeIdentity(tx, id);
      await tx.user.update({ where: { id }, data: { deleted_at: new Date(), is_active: false } });
      await AuditService.record(tx, 'user.deactivated', actor.id, id);
    });
  }
  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.authorization.serialize(tx);
        return fn(tx);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Email already exists');
      throw error;
    }
  }
}
