// ═══════════════════════════════════════════
// Auth SDK — Permissions Guard
// ═══════════════════════════════════════════

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RequestUser } from '../interfaces/request-user.interface';
import { PrismaService } from '../../../../database/prisma.service';
import { grantPermissions } from '../../../../modules/roles/authorization';
import { requestCourse } from '../../../../modules/roles/request-scope';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: RequestUser;
      originalUrl: string;
      params: Record<string, string>;
      body: Record<string, unknown>;
    }>();
    const user = request.user;

    if (!user) return false;
    user.scopeCourseId = await requestCourse(this.prisma, request);
    user.requiredPermissions = requiredPermissions;
    if (user.grants) user.permissions = grantPermissions(user.grants, user.scopeCourseId, user.id);

    // Preserve unverified student reading; staff/custom roles and permissioned writes require verification.
    if (
      !user.isEmailVerified &&
      ((user.grants
        ? user.grants.some((g) => g.group !== 'STUDENT')
        : user.roleName !== 'student') ||
        requiredPermissions.some(
          (perm) =>
            ![
              'courses:read',
              'lessons:read',
              'quizzes:read',
              'uploads:read',
              'learning:read',
            ].includes(perm),
        ))
    )
      return false;

    return requiredPermissions.every((perm) => user.permissions.includes(perm));
  }
}
