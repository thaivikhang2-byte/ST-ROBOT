// ═══════════════════════════════════════════
// Idempotency SDK — Interceptor
// Checks and caches idempotent requests
// ═══════════════════════════════════════════

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { IDEMPOTENT_KEY, IdempotentOptions } from './decorators/idempotent.decorator';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const options = this.reflector.get<IdempotentOptions>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const idempotencyKey = request.headers['idempotency-key'] as string;

    // No key provided — proceed normally
    if (!idempotencyKey) {
      return next.handle();
    }

    // Check for existing record
    const existing = await this.idempotencyService.get(idempotencyKey);
    if (existing) {
      response.status(existing.statusCode);
      return of(existing.response);
    }

    // Process and cache
    return next.handle().pipe(
      tap((data) => {
        this.idempotencyService
          .set(
            idempotencyKey,
            {
              statusCode: response.statusCode || HttpStatus.OK,
              response: data,
              createdAt: new Date().toISOString(),
            },
            options.ttlSeconds || 86400,
          )
          .catch(() => {
            // Silently fail cache writes
          });
      }),
    );
  }
}
