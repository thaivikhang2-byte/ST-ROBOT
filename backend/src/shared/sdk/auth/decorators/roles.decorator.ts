// ═══════════════════════════════════════════
// Auth SDK — @Roles() Decorator
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Specify which roles are allowed to access an endpoint.
 *
 * @example
 * @Roles('admin', 'superadmin')
 * @Get('users')
 * findAll() { ... }
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
