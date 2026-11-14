import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PaginationQueryDto, PaginatedResult } from '../../shared/sdk';
import { NotFoundException } from '../../shared/sdk/errors/domain.exception';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string, query: PaginationQueryDto) {
    const where = { user_id: userId, channel: 'in_app' };
    const [data, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, is_read: false } }),
    ]);
    return { ...new PaginatedResult(data, total, query.page, query.limit), unread };
  }
  async read(userId: string, id: string) {
    const row = await this.prisma.notification.updateMany({
      where: { id, user_id: userId },
      data: { is_read: true, read_at: new Date() },
    });
    if (!row.count) throw new NotFoundException('Notification');
    return { id, isRead: true };
  }
}
