// ═══════════════════════════════════════════
// Cache SDK — Cache Interceptor
// Auto-caches responses for @Cacheable endpoints
// ═══════════════════════════════════════════

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CacheService } from './cache.service';
import { CACHEABLE_KEY, CacheableOptions } from './decorators/cacheable.decorator';
import { Request } from 'express';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cacheService: CacheService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const options = this.reflector.get<CacheableOptions>(
      CACHEABLE_KEY,
      context.getHandler(),
    );

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const cacheKey = this.buildKey(options.key, request);

    const cached = await this.cacheService.get(cacheKey);
    if (cached !== null) {
      return of(cached);
    }

    return next.handle().pipe(
      tap((data) => {
        this.cacheService.set(cacheKey, data, options.ttl).catch(() => {
          // Silently fail cache writes
        });
      }),
    );
  }

  private buildKey(baseKey: string, request: Request): string {
    const query = request.query;
    const queryString = Object.keys(query)
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join('&');
    return queryString ? `${baseKey}:${queryString}` : baseKey;
  }
}
