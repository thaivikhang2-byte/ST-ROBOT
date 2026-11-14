import { Injectable } from '@nestjs/common';
import { ApprovalRequest, Prisma } from '@prisma/client';
import { AuthorizationService } from './authorization.service';
import { RoleManagementService } from './role-management.service';
import { ApprovalCreateDto, ApprovalQueryDto } from './management.dto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  DomainException,
} from '../../shared/sdk/errors/domain.exception';
import { PaginatedResult } from '../../shared/sdk';
import { auditContent, lockCourse } from '../courses/content-integrity';
import { activateEnrollment } from '../progress/enrollment.repository';
import { Cron } from '@nestjs/schedule';
@Injectable()
export class ApprovalService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly roles: RoleManagementService,
  ) {}
  @Cron('0 * * * * *')
  async expirePending() {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const rows = await tx.approvalRequest.findMany({
        where: {
          status: { in: ['PENDING', 'PARTIALLY_APPROVED'] },
          expires_at: { lte: new Date() },
        },
        select: { id: true },
        take: 100,
      });
      if (!rows.length) return 0;
      await tx.approvalRequest.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'EXPIRED' },
      });
      await tx.auditLog.createMany({
        data: rows.map((r) => ({
          action: 'approval.expired',
          resource: 'approval_request',
          resource_id: r.id,
        })),
      });
      return rows.length;
    });
  }
  private proposal(row: ApprovalRequest) {
    return row.proposed as {
      roleId?: string;
      revision?: number;
      group?: string;
      reason: string;
      expiresAt?: string;
    };
  }
  private async authority(tx: Prisma.TransactionClient, row: ApprovalRequest, actorId: string) {
    if (row.requester_id === actorId || row.beneficiary_id === actorId)
      throw new ForbiddenException('Independent approval required');
    const scope = row.scope_type === 'COURSE' ? row.scope_id : undefined;
    const actor = await this.auth.actor(
      tx,
      actorId,
      row.type === 'COURSE_ENROLLMENT' ? 'enrollments:approve' : 'approvals:manage',
      scope,
    );
    if (row.type === 'COURSE_ENROLLMENT') {
      const course = await tx.course.findFirst({
        where: {
          id: row.scope_id,
          deleted_at: null,
          status: 'published',
          enrollment_approval_required: true,
        },
      });
      if (
        !course ||
        !(
          course.creator_id === actorId ||
          actor.grants.some((g) => g.group === 'MANAGER' && g.scopeType === 'SYSTEM') ||
          actor.grants.some(
            (g) =>
              g.scopeType === 'COURSE' &&
              g.scopeId === course.id &&
              g.permissions.includes('enrollments:approve'),
          )
        )
      )
        throw new ForbiddenException('Enrollment approval scope required');
    } else {
      const proposal = this.proposal(row);
      const role = await tx.role.findUnique({
        where: { id: proposal.roleId },
        include: { role_permissions: { include: { permission: true } } },
      });
      if (
        !role ||
        !role.is_active ||
        role.status !== 'ACTIVE' ||
        role.revision !== proposal.revision ||
        role.group !== proposal.group
      )
        throw new ConflictException('Proposed role changed; cancel and submit a new request');
      await this.auth.actor(tx, actorId, 'roles:assign', scope);
      await this.auth.delegate(
        tx,
        actorId,
        role.role_permissions.map((p) => p.permission.name),
        role.group,
        row.scope_type,
        row.scope_id,
        proposal.expiresAt ? new Date(proposal.expiresAt) : undefined,
      );
    }
  }
  async create(dto: ApprovalCreateDto, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const actor = await this.auth.actor(tx, actorId);
      if (!actor.is_email_verified) throw new ForbiddenException('Email verification required');
      const beneficiary = dto.beneficiaryId ?? actorId;
      if (
        ['TEACHER_APPLICATION', 'COURSE_ENROLLMENT'].includes(dto.type) &&
        beneficiary !== actorId
      )
        throw new ForbiddenException(
          'Self-service requests must concern the authenticated account',
        );
      if (['MANAGER_APPOINTMENT', 'ROLE_CHANGE'].includes(dto.type))
        await this.auth.actor(
          tx,
          actorId,
          'roles:assign',
          dto.scopeType === 'COURSE' ? dto.scopeId : undefined,
        );
      await this.auth.subject(tx, beneficiary);
      const scopeId = await this.auth.scope(tx, dto.scopeType, dto.scopeId, beneficiary);
      if (dto.expiresAt && new Date(dto.expiresAt) <= new Date())
        throw new ForbiddenException('Appointment expiration must be in the future');
      let proposed: Prisma.InputJsonObject = {
          reason: dto.reason.trim(),
          ...(dto.expiresAt ? { expiresAt: dto.expiresAt } : {}),
        },
        required = 1;
      if (dto.type === 'COURSE_ENROLLMENT') {
        if (beneficiary !== actorId || dto.scopeType !== 'COURSE' || dto.roleId)
          throw new ForbiddenException(
            'Enrollment requests must concern your own course enrollment',
          );
        const course = await tx.course.findFirst({
          where: {
            id: scopeId,
            status: 'published',
            deleted_at: null,
            enrollment_approval_required: true,
          },
        });
        if (!course) throw new ForbiddenException('Course does not require enrollment approval');
        if (
          await tx.enrollment.findFirst({
            where: { user_id: beneficiary, course_id: scopeId, status: 'active', deleted_at: null },
          })
        )
          throw new ConflictException('Already enrolled');
      } else {
        const role = dto.roleId
          ? await tx.role.findUnique({ where: { id: dto.roleId } })
          : await tx.role.findUnique({ where: { name: 'teacher' } });
        if (
          !role ||
          !role.is_active ||
          role.status !== 'ACTIVE' ||
          ['guest', 'superadmin'].includes(role.name)
        )
          throw new ForbiddenException('Role cannot be appointed by this workflow');
        if (dto.scopeType === 'SELF' && role.group !== 'STUDENT')
          throw new ForbiddenException('Staff appointments require COURSE or SYSTEM scope');
        if (dto.type === 'TEACHER_APPLICATION') {
          if (beneficiary !== actorId || role.group !== 'TEACHER')
            throw new ForbiddenException('Teacher application must concern your own teacher role');
        } else {
          if (beneficiary === actorId)
            throw new ForbiddenException('Self-appointment is forbidden');
          await this.auth.actor(
            tx,
            actorId,
            'roles:assign',
            dto.scopeType === 'COURSE' ? scopeId : undefined,
          );
          if (dto.type === 'MANAGER_APPOINTMENT' && role.group !== 'MANAGER')
            throw new ForbiddenException('Manager role required');
          await this.auth.delegate(
            tx,
            actorId,
            (
              await tx.rolePermission.findMany({
                where: { role_id: role.id },
                include: { permission: true },
              })
            ).map((p) => p.permission.name),
            role.group,
            dto.scopeType,
            scopeId,
            dto.expiresAt ? new Date(dto.expiresAt) : undefined,
          );
        }
        if (
          !['teacher', 'admin', 'student'].includes(role.name) &&
          role.scope_type !== dto.scopeType
        )
          throw new ForbiddenException('Scope does not match role definition');
        proposed = { ...proposed, roleId: role.id, revision: role.revision, group: role.group };
        required = role.group === 'MANAGER' ? 2 : 1;
      }
      if (
        await tx.approvalRequest.findFirst({
          where: {
            type: dto.type,
            beneficiary_id: beneficiary,
            scope_type: dto.scopeType,
            scope_id: scopeId,
            status: { in: ['PENDING', 'PARTIALLY_APPROVED'] },
            expires_at: { gt: new Date() },
            ...(proposed.roleId ? { proposed: { path: ['roleId'], equals: proposed.roleId } } : {}),
          },
        })
      )
        throw new ConflictException('A matching pending request already exists');
      const row = await tx.approvalRequest.create({
        data: {
          type: dto.type,
          requester_id: actorId,
          beneficiary_id: beneficiary,
          proposed,
          required_approvals: required,
          scope_type: dto.scopeType,
          scope_id: scopeId,
          expires_at: new Date(
            Math.min(
              Date.now() + 7 * 86400000,
              dto.expiresAt ? new Date(dto.expiresAt).getTime() : Infinity,
            ),
          ),
        },
      });
      await auditContent(tx, 'approval.requested', actorId, 'approval_request', row.id);
      await tx.notification.create({
        data: {
          user_id: actorId,
          type: 'approval',
          title: 'Đã gửi yêu cầu phê duyệt',
          body: `Yêu cầu cần ${required} người phê duyệt độc lập.`,
          data: { requestId: row.id },
        },
      });
      return row;
    });
  }
  private async visible(tx: Prisma.TransactionClient, row: ApprovalRequest, actorId: string) {
    if (row.requester_id === actorId || row.beneficiary_id === actorId) return true;
    const viewer = await this.auth.actor(tx, actorId);
    if (
      viewer.is_email_verified &&
      viewer.permissions.includes('approvals:manage') &&
      viewer.grants.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM')
    )
      return true;
    try {
      await this.authority(tx, row, actorId);
      return true;
    } catch (error) {
      if (error instanceof DomainException) return false;
      throw error;
    }
  }
  async list(actorId: string, query: ApprovalQueryDto) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.actor(tx, actorId);
      const candidates = await tx.approvalRequest.findMany({
        where: {
          ...(query.type ? { type: query.type } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.search
            ? {
                beneficiary: {
                  OR: [
                    { email: { contains: query.search, mode: 'insensitive' } },
                    { first_name: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              }
            : {}),
        },
        include: { beneficiary: { select: { id: true, first_name: true, last_name: true } } },
        orderBy: { created_at: 'desc' },
        take: 2001,
      });
      // Bounded exact visibility avoids leaking counts; replace with a policy-indexed query above 2,000 requests.
      if (candidates.length > 2000)
        throw new ConflictException(
          'Approval history exceeds safe query bound; filter by type/status',
        );
      const rows: ApprovalRequest[] = [];
      for (const row of candidates) if (await this.visible(tx, row, actorId)) rows.push(row);
      return new PaginatedResult(
        rows.slice(query.skip, query.skip + query.take),
        rows.length,
        query.page,
        query.limit,
      );
    });
  }
  async detail(id: string, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.actor(tx, actorId);
      const row = await tx.approvalRequest.findUnique({
        where: { id },
        include: {
          beneficiary: { select: { id: true, first_name: true, last_name: true } },
          decisions: { orderBy: { created_at: 'asc' } },
        },
      });
      if (!row) throw new NotFoundException('Approval');
      if (!(await this.visible(tx, row, actorId)))
        throw new ForbiddenException('Approval visibility denied');
      return row;
    });
  }
  async decide(id: string, actorId: string, approved: boolean, reason: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      const row = await tx.approvalRequest.findUnique({
        where: { id },
        include: { decisions: true },
      });
      if (!row) throw new NotFoundException('Approval');
      if (!['PENDING', 'PARTIALLY_APPROVED'].includes(row.status))
        throw new ConflictException('Request has already been finalized');
      if (row.expires_at <= new Date())
        throw new ConflictException('Request expired; submit a new request');
      if (row.type === 'COURSE_ENROLLMENT') await lockCourse(tx, row.scope_id);
      await this.authority(tx, row, actorId);
      if (row.decisions.some((d) => d.approver_id === actorId))
        throw new ConflictException('Approver has already decided');
      await tx.approvalDecision.create({
        data: { request_id: id, approver_id: actorId, approved, reason: reason.trim() },
      });
      let count = approved ? 1 : 0;
      for (const previous of row.decisions.filter((d) => d.approved)) {
        try {
          await this.authority(tx, row, previous.approver_id);
          count++;
        } catch (error) {
          if (!(error instanceof DomainException)) throw error;
        }
      }
      const status = !approved
        ? 'REJECTED'
        : count >= row.required_approvals
          ? 'APPROVED'
          : 'PARTIALLY_APPROVED';
      if (status === 'APPROVED') {
        if (row.type === 'COURSE_ENROLLMENT') {
          await this.auth.subject(tx, row.beneficiary_id);
          await activateEnrollment(tx, row.beneficiary_id, row.scope_id);
          await auditContent(tx, 'learning.enrolled', row.beneficiary_id, 'course', row.scope_id);
        } else
          await this.roles.grant(
            tx,
            {
              userId: row.beneficiary_id,
              roleId: this.proposal(row).roleId!,
              scopeType: row.scope_type,
              ...(row.scope_id ? { scopeId: row.scope_id } : {}),
              ...(this.proposal(row).expiresAt ? { expiresAt: this.proposal(row).expiresAt } : {}),
            },
            actorId,
            true,
          );
      }
      const result = await tx.approvalRequest.update({
        where: { id },
        data: { status, approval_count: count },
      });
      await auditContent(
        tx,
        approved ? 'approval.approved' : 'approval.rejected',
        actorId,
        'approval_request',
        id,
      );
      await tx.notification.create({
        data: {
          user_id: row.beneficiary_id,
          type: 'approval',
          title:
            status === 'APPROVED'
              ? 'Yêu cầu đã được duyệt'
              : status === 'REJECTED'
                ? 'Yêu cầu bị từ chối'
                : 'Yêu cầu được duyệt một phần',
          body: `Tiến độ phê duyệt: ${count}/${row.required_approvals}.`,
          data: { requestId: id },
        },
      });
      return result;
    });
  }
  async cancel(id: string, actorId: string) {
    return this.auth.prisma.$transaction(async (tx) => {
      await this.auth.serialize(tx);
      await this.auth.actor(tx, actorId);
      const row = await tx.approvalRequest.findUnique({ where: { id } });
      if (!row || row.requester_id !== actorId)
        throw new ForbiddenException('Only requester may cancel');
      if (!['PENDING', 'PARTIALLY_APPROVED'].includes(row.status))
        throw new ConflictException('Already finalized');
      await auditContent(tx, 'approval.cancelled', actorId, 'approval_request', id);
      return tx.approvalRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
  }
}
