// ═══════════════════════════════════════════
// Queue — Queue Module
// Bull queue integration for background jobs
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        // Disposable browser/Jest processes must never consume one another's jobs.
        prefix:
          configService.get<string>('NODE_ENV') === 'test'
            ? `st-robot-test-${process.pid}`
            : 'bull',
        redis: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
          password: configService.get<string>('redis.password') || undefined,
        },
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
