// ═══════════════════════════════════════════
// Auth SDK — @CurrentUser() Decorator
// Extract authenticated user from request
// ═══════════════════════════════════════════

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from '../interfaces/request-user.interface';

/**
 * Extract the current authenticated user from the request.
 *
 * @example
 * @Get('profile')
 * getProfile(@CurrentUser() user: RequestUser) { ... }
 *
 * @Get('profile')
 * getEmail(@CurrentUser('email') email: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as RequestUser;
    return data ? user?.[data] : user;
  },
);
