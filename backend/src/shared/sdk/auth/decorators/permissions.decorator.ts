// ═══════════════════════════════════════════
// Auth SDK — @Permissions() Decorator
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Specify which permissions are required to access an endpoint.
 *
 * @example
 * @Permissions('course:create', 'course:update')
 * @Post('courses')
 * create() { ... }
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
