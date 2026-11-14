// ═══════════════════════════════════════════
// Retention SDK — Retention Service
// Policy-based data cleanup
// ═══════════════════════════════════════════

import { Injectable } from '@nestjs/common';
import { IRetentionPolicy, DEFAULT_RETENTION_POLICIES } from './interfaces/retention-policy.interface';

@Injectable()
export class RetentionService {
  private policies: IRetentionPolicy[] = [...DEFAULT_RETENTION_POLICIES];

  /**
   * Register a custom retention policy.
   */
  registerPolicy(policy: IRetentionPolicy): void {
    this.policies.push(policy);
  }

  /**
   * Get all registered policies.
   */
  getPolicies(): IRetentionPolicy[] {
    return [...this.policies];
  }

  /**
   * Calculate the cutoff date for a given retention period.
   */
  getCutoffDate(retentionDays: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    return cutoff;
  }

  /**
   * Execute all retention policies.
   * Called by the Scheduler module on a cron schedule.
   *
   * TODO: Implement in Phase 13 — inject PrismaService
   * and delete records older than cutoff date.
   */
  async executeAll(): Promise<void> {
    // Will be implemented when PrismaService is wired
    for (const policy of this.policies) {
      const cutoff = this.getCutoffDate(policy.retentionDays);
      // prisma[policy.modelName].deleteMany({
      //   where: { [policy.dateField]: { lt: cutoff } }
      // });
    }
  }
}
