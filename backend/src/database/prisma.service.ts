// ═══════════════════════════════════════════
// Database — Prisma Service
// Lifecycle-managed Prisma Client
// ═══════════════════════════════════════════

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from './client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      // Prisma diagnostics can include query inputs. Security audit events are recorded separately.
      log: [],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Schema changes belong to versioned migrations, never process startup.
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Clean database for testing.
   * Only available in test environment.
   */
  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('cleanDatabase() is only available in test environment');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    ) as string[];

    for (const model of models) {
      const delegate = (this as Record<string, any>)[model];
      if (delegate?.deleteMany) {
        await delegate.deleteMany();
      }
    }
  }
}
