import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AiMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('0 */10 * * * *')
  async maintain() {
    await this.prisma.$transaction(async (tx) => {
      await tx.aiQuotaPolicy.updateMany({
        where: { id: 'default' },
        data: { lock_version: { increment: 1 } },
      });
      await tx.aiUsageRecord.updateMany({
        where: { status: 'reserved', deadline_at: { lt: new Date(Date.now() - 60000) } },
        data: { status: 'interrupted', error_category: 'AI_TIMEOUT', finished_at: new Date() },
      });
      // Reservations remain charged after a crash. Purging is opt-in operator configuration.
      const days = Number(this.config.get('AI_USAGE_RETENTION_DAYS', 0));
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 86400000);
        cutoff.setUTCHours(0, 0, 0, 0);
        await tx.aiUsageRecord.deleteMany({ where: { finished_at: { lt: cutoff } } });
        await tx.aiUsageBucket.deleteMany({ where: { day: { lt: cutoff } } });
      }
    });
  }
}
