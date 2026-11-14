import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../roles/authorization.service';
@Injectable()
export class OperationsAccess {
  constructor(private readonly db: PrismaService) {}
  async check(actorId: string, permission = 'system:read') {
    const actor = await this.db.$transaction((tx) =>
      new AuthorizationService(this.db).actor(tx, actorId, permission),
    );
    if (
      !actor.grants.some(
        (g) =>
          g.group === 'MANAGER' && g.scopeType === 'SYSTEM' && g.permissions.includes(permission),
      )
    )
      throw new ForbiddenException('System manager scope required');
    return actor;
  }
}
