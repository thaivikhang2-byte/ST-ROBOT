// ═══════════════════════════════════════════
// Policy SDK — @UsePolicy() Decorator
// ═══════════════════════════════════════════

import { SetMetadata, Type } from '@nestjs/common';
import { IPolicy } from './policy.interface';

export const POLICY_KEY = 'policy';

/**
 * Apply a policy guard to an endpoint.
 *
 * @example
 * @UsePolicy(CourseOwnerPolicy)
 * @Put(':id')
 * update(@Param('id') id: string) { ... }
 */
export const UsePolicy = (...policies: Type<IPolicy>[]) =>
  SetMetadata(POLICY_KEY, policies);
