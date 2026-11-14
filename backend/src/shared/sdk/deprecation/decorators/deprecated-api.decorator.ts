// ═══════════════════════════════════════════
// Deprecation SDK — @DeprecatedApi() Decorator
// ═══════════════════════════════════════════

import { SetMetadata } from '@nestjs/common';

export const DEPRECATED_API_KEY = 'deprecatedApi';

export interface DeprecatedApiOptions {
  sunset: string; // ISO date when endpoint will be removed
  successor?: string; // Path to the replacement endpoint
  notice?: string; // Custom message
}

/**
 * Mark an API endpoint as deprecated.
 * Adds Sunset, Deprecation, and Link headers to the response.
 *
 * @example
 * @DeprecatedApi({ sunset: '2028-01-01', successor: '/api/v2/courses' })
 * @Get('courses')
 * findAll() { ... }
 */
export const DeprecatedApi = (options: DeprecatedApiOptions) =>
  SetMetadata(DEPRECATED_API_KEY, options);
