import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { operationsConfig } from '../config/configurations';

@Injectable()
export class MetricsGuard implements CanActivate {
  constructor(
    @Inject(operationsConfig.KEY) private readonly config: ConfigType<typeof operationsConfig>,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const header: unknown = context.switchToHttp().getRequest<Request>().headers.authorization;
    const expected = this.config.metricsToken;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const actualBytes = Buffer.from(token),
      expectedBytes = Buffer.from(expected);
    if (
      !expected ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    )
      throw new UnauthorizedException('Monitoring authentication required');
    return true;
  }
}
