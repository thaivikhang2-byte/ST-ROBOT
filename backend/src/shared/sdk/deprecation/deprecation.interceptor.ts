// ═══════════════════════════════════════════
// Deprecation SDK — Interceptor
// Adds Sunset and Deprecation headers
// ═══════════════════════════════════════════

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { Response } from 'express';
import {
  DEPRECATED_API_KEY,
  DeprecatedApiOptions,
} from './decorators/deprecated-api.decorator';

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<DeprecatedApiOptions>(
      DEPRECATED_API_KEY,
      context.getHandler(),
    );

    if (options) {
      const response = context.switchToHttp().getResponse<Response>();

      response.setHeader('Deprecation', 'true');
      response.setHeader(
        'Sunset',
        new Date(options.sunset).toUTCString(),
      );

      if (options.successor) {
        response.setHeader('Link', `<${options.successor}>; rel="successor-version"`);
      }

      if (options.notice) {
        response.setHeader('X-Deprecation-Notice', options.notice);
      }
    }

    return next.handle();
  }
}
