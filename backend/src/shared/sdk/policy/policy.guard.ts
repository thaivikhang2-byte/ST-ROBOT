// ═══════════════════════════════════════════
// Policy SDK — Policy Guard
// Evaluates policies set via @UsePolicy()
// ═══════════════════════════════════════════

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Type,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import { POLICY_KEY } from './policy.decorator';
import { IPolicy } from './policy.interface';
import { RequestUser } from '../auth/interfaces/request-user.interface';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policyClasses = this.reflector.getAllAndOverride<Type<IPolicy>[]>(POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!policyClasses || policyClasses.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser;

    if (!user) {
      throw new ForbiddenException('Authentication required for policy evaluation');
    }

    // Build policy context from request
    const policyContext = {
      params: request.params,
      query: request.query,
      body: request.body,
      request,
    };

    // Evaluate all policies (all must pass)
    for (const PolicyClass of policyClasses) {
      const policy = await this.moduleRef.resolve(PolicyClass, undefined, { strict: false });
      const allowed = await policy.validate(user, policyContext);

      if (!allowed) {
        throw new ForbiddenException(`Policy ${PolicyClass.name} denied access`);
      }
    }

    return true;
  }
}
