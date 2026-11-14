// ═══════════════════════════════════════════
// Response SDK — Transform Interceptor
// Auto-wraps controller returns into ApiResponse
// ═══════════════════════════════════════════

import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { PaginatedResult } from '../pagination/paginated-result.dto';
import { currentContext } from '../logger/request-context';

export interface TransformedResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta: {
    timestamp: string;
    path: string;
    method: string;
    [key: string]: unknown;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, TransformedResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<TransformedResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        // If already wrapped (e.g., ApiResponse.ok()), preserve it
        if (request.path.endsWith('/system/metrics')) return data as TransformedResponse<T>;
        if (data && typeof data === 'object' && 'success' in data && 'meta' in data) {
          return data as TransformedResponse<T>;
        }

        return {
          success: true,
          message: 'Success',
          data: (data instanceof PaginatedResult ? data.data : data) as T,
          meta: {
            timestamp: new Date().toISOString(),
            path: request.path,
            requestId: currentContext()?.requestId,
            method: request.method,
            ...(data instanceof PaginatedResult ? data.meta : {}),
          },
        };
      }),
    );
  }
}
