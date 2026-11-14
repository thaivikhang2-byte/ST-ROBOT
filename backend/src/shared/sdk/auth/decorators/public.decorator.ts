// ═══════════════════════════════════════════
// Auth SDK — @Public() Decorator
// Mark endpoints as publicly accessible
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark an endpoint as public (skip JWT authentication).
 *
 * @example
 * @Public()
 * @Get('courses')
 * findPublicCourses() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
