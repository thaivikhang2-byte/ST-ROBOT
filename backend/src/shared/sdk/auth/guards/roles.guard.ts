// ═══════════════════════════════════════════
// Auth SDK — Roles Guard
// ═══════════════════════════════════════════

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../interfaces/request-user.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) return false;

    return requiredRoles.some((role) =>
      role === 'superadmin'
        ? !!user.grants?.some((g) => g.roleName === 'superadmin' && g.scopeType === 'SYSTEM') ||
          (!user.grants && user.roleName === 'superadmin')
        : user.grants
          ? user.grants.some(
              (g) =>
                g.roleName === role ||
                g.group === { admin: 'MANAGER', teacher: 'TEACHER', student: 'STUDENT' }[role],
            )
          : user.roleName === role,
    );
  }
}
