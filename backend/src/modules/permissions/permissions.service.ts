import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  DomainException,
} from '../../shared/sdk/errors/domain.exception';
import { ErrorCode } from '../../shared/sdk/errors/error-codes.enum';
import { Permission } from '../../shared/constants/permissions.constant';
import { AuditService } from '../audit/audit.service';
import { CreatePermissionDto, UpdatePermissionDto } from './permission.dto';
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll(query: PaginationQueryDto) {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.permission.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { name: 'asc' },
      }),
      this.prisma.permission.count({ where }),
    ]);
    return new PaginatedResult(data, total, query.page, query.limit);
  }
  async findById(id: string) {
    const value = await this.prisma.permission.findUnique({ where: { id } });
    if (!value) throw new NotFoundException('Permission', id);
    return value;
  }
  private validate(data: { name: string; resource: string; action: string }) {
    if (data.name !== data.resource + ':' + data.action)
      throw new DomainException(
        'Permission name must equal resource:action',
        ErrorCode.VALIDATION_ERROR,
      );
  }
  async create(dto: CreatePermissionDto, actorId: string) {
    this.validate(dto);
    return this.mutate(async (tx) => {
      const value = await tx.permission.create({ data: dto });
      await AuditService.record(tx, 'permission.created', actorId, value.id);
      return value;
    });
  }
  async update(id: string, dto: UpdatePermissionDto, actorId: string) {
    return this.mutate(async (tx) => {
      const current = await tx.permission.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Permission', id);
      if ((Object.values(Permission) as string[]).includes(current.name))
        throw new ForbiddenException('Built-in permissions are immutable');
      if (await tx.rolePermission.count({ where: { permission_id: id } }))
        throw new ConflictException('Assigned permissions cannot be modified');
      const data = { ...current, ...dto };
      this.validate(data);
      const value = await tx.permission.update({
        where: { id },
        data: {
          name: data.name,
          resource: data.resource,
          action: data.action,
          description: data.description,
        },
      });
      await AuditService.record(tx, 'permission.updated', actorId, id);
      return value;
    });
  }
  async delete(id: string, actorId: string): Promise<void> {
    await this.mutate(async (tx) => {
      const current = await tx.permission.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Permission', id);
      if ((Object.values(Permission) as string[]).includes(current.name))
        throw new ForbiddenException('Built-in permissions cannot be deleted');
      if (await tx.rolePermission.count({ where: { permission_id: id } }))
        throw new ConflictException('Permission is assigned to roles');
      await tx.permission.delete({ where: { id } });
      await AuditService.record(tx, 'permission.deleted', actorId, id);
    });
  }
  private async mutate<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2003', 'P2034'].includes(error.code)
      )
        throw new ConflictException('Permission conflict; reload and retry');
      throw error;
    }
  }
}
