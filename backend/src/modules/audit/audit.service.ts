import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
@Injectable()
export class AuditService {
  static async record(
    tx: Prisma.TransactionClient,
    action: string,
    userId?: string,
    resourceId?: string,
  ): Promise<void> {
    // Deliberate allowlist: never store request bodies, passwords or tokens.
    await tx.auditLog.create({
      data: { action, user_id: userId, resource: 'identity', resource_id: resourceId },
    });
  }
}
