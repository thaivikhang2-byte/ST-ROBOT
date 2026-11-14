import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class LearningMaintenanceService {
  constructor(private readonly prisma: PrismaService) {}
  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async expireAttempts() {
    const now = new Date();
    const rows = await this.prisma.quizAttempt.findMany({
      where: { status: 'in_progress', deadline_at: { lte: now } },
      select: { id: true },
      orderBy: { deadline_at: 'asc' },
      take: 500,
    });
    if (!rows.length) return 0;
    const result = await this.prisma.quizAttempt.updateMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        status: 'in_progress',
        deadline_at: { lte: now },
      },
      data: { status: 'expired', finished_at: now },
    });
    return result.count;
  }
}
