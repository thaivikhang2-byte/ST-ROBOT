// ═══════════════════════════════════════════
// App Module — Root Module
// Wires all infrastructure and business modules
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { AuthorizationModule } from './modules/roles/authorization.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './shared/sdk/auth/guards/jwt-auth.guard';
import { RolesGuard } from './shared/sdk/auth/guards/roles.guard';
import { PermissionsGuard } from './shared/sdk/auth/guards/permissions.guard';
import { PolicyGuard } from './shared/sdk/policy/policy.guard';
import { GlobalExceptionFilter } from './shared/sdk/errors/filters/global-exception.filter';
import { TransformInterceptor } from './shared/sdk/response/transform.interceptor';
import { RedisService } from './redis/redis.service';
import { RedisThrottlerStorage } from './redis/throttler.storage';
import { ConfigService } from '@nestjs/config';

// Infrastructure
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';

// SDK Modules
import { LoggerModule } from './shared/sdk/logger/logger.module';
import { EventBusModule } from './shared/sdk/events/event-bus.module';
import { CacheModule } from './shared/sdk/cache/cache.module';
import { LockModule } from './shared/sdk/lock/lock.module';
import { SecretsModule } from './shared/sdk/secrets/secrets.module';
import { IdempotencyModule } from './shared/sdk/idempotency/idempotency.module';
import { RetentionModule } from './shared/sdk/retention/retention.module';

// System
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';

// API Gateway
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    // ──────────────────────────────────────────────
    // Infrastructure Modules (loaded first)
    // ──────────────────────────────────────────────
    AppConfigModule,
    AuthorizationModule,
    DatabaseModule,
    RedisModule,
    QueueModule,

    // Schedule
    ScheduleModule.forRoot(),

    // Rate Limiting
    ThrottlerModule.forRootAsync({
      useFactory: (configService: ConfigService, redis: RedisService) => ({
        throttlers: [
          {
            ttl: (configService.get<number>('throttle.ttl') || 60) * 1000,
            limit: configService.get<number>('throttle.limit') || 100,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
      inject: [ConfigService, RedisService],
    }),

    // ──────────────────────────────────────────────
    // SDK Modules (Global)
    // ──────────────────────────────────────────────
    LoggerModule,
    EventBusModule,
    CacheModule,
    LockModule,
    SecretsModule,
    IdempotencyModule,
    RetentionModule,

    // ──────────────────────────────────────────────
    // System Modules
    // ──────────────────────────────────────────────
    HealthModule,
    MetricsModule,

    // ──────────────────────────────────────────────
    // API Gateway Layer (routes all business modules)
    // ──────────────────────────────────────────────
    ApiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PolicyGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
