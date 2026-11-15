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
import { ConfigService } from '@nestjs/config';
import { ManagedStudentDto, ManagedStudentPasswordDto } from './dto/managed-student.dto';
import { resolveGrants } from '../roles/authorization';
import { managementProfile, studentManagementMetadata } from './management-profile';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  private async managedActor(tx: Prisma.TransactionClient, actor: RequestUser, permission: string) {
    if (!this.config.get<boolean>('feature.managedAccountsEnabled', false))
      throw new ForbiddenException('Administrator-managed accounts are not enabled');
    const current = await this.authorization.actor(tx, actor.id, permission);
    if (!current.grants.some((grant) => grant.group === 'MANAGER' &&
      grant.scopeType === 'SYSTEM' && grant.permissions.includes(permission)))
      throw new ForbiddenException('Verified system management authority required');
    return { ...actor, grants: current.grants, permissions: current.permissions,
      roleId: current.role.id, roleName: current.role.name, isEmailVerified: current.is_email_verified };
  }

  async createStudent(dto: ManagedStudentDto, actor: RequestUser) {
    const password_hash = await hashPassword(dto.password);
    return this.mutate(async (tx) => {
      const manager = await this.managedActor(tx, actor, 'users:create');
      const role = await tx.role.findUnique({ where: { name: 'student' } });
      if (!role || !role.is_active || role.status !== 'ACTIVE' || role.group !== 'STUDENT')
        throw new ForbiddenException('The student role is unavailable');
      await this.assignable(tx, role.id, manager);
      const user = await tx.user.create({
        data: {
          email: dto.email.trim().toLowerCase(), password_hash,
          first_name: dto.firstName, last_name: dto.lastName, role_id: role.id,
          is_email_verified: true, rbac_migrated: true,
          role_assignments: { create: { role_id: role.id, assigned_by: actor.id } },
        },
        include: identityInclude,
      });
      // "Verified" here is an explicit administrator attestation of a school
      // identity, not a claim that SMTP delivered to this address.
      await AuditService.record(tx, 'user.managed_student_created', actor.id, user.id);
      await AuditService.record(tx, 'user.identity_attested_by_manager', actor.id, user.id);
      return profile(user);
    });
  }

  async resetStudentPassword(id: string, dto: ManagedStudentPasswordDto, actor: RequestUser) {
    const password_hash = await hashPassword(dto.newPassword);
    return this.mutate(async (tx) => {
      await this.managedActor(tx, actor, 'users:update');
      const user = await lockIdentity(tx, id);
      const grants = resolveGrants(user);
      if (id === actor.id || !studentManagementMetadata(user).studentOnly || !user.is_active || !grants.length)
        throw new ForbiddenException('Only a separate active student account can be reset');
      await revokeIdentity(tx, id);
      await tx.credentialToken.updateMany({
        where: { user_id: id, consumed_at: null }, data: { consumed_at: new Date() },
      });
      await tx.user.update({ where: { id }, data: { password_hash } });
      await AuditService.record(tx, 'user.student_password_reset_by_manager', actor.id, id);
      return { message: 'Student password updated; all previous sessions revoked' };
    });
  }
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
    return new PaginatedResult(users.map(managementProfile), total, query.page, query.limit);
  }
  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: identityInclude });
    if (!user || user.deleted_at) throw new NotFoundException('User', id);
    return managementProfile(user);
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
    return this.updateIdentity(id, dto, actor, false);
  }
  async updateStudentStatus(id: string, isActive: boolean, actor: RequestUser) {
    return this.updateIdentity(id, { isActive }, actor, true);
  }
  private async updateIdentity(id: string, dto: UpdateUserDto, actor: RequestUser, studentStatusOnly: boolean) {
    return this.mutate(async (tx) => {
      const current = await this.authorization.actor(tx, actor.id, 'users:update');
      const user = await lockIdentity(tx, id);
      if (user.deleted_at) throw new NotFoundException('User', id);
      if (studentStatusOnly && (!current.grants.some(grant => grant.group === 'MANAGER' &&
        grant.scopeType === 'SYSTEM' && grant.permissions.includes('users:update')) ||
        !studentManagementMetadata(user).studentOnly))
        throw new ForbiddenException('Only verified system managers can change a student-only account status');
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
