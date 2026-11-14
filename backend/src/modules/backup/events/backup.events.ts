import { BaseDomainEvent } from '../../../shared/sdk/events/base.event';

export class BackupCompletedEvent extends BaseDomainEvent {
  constructor(backupId: string, filename: string, size: number) {
    super('backup.completed', { backupId, filename, size });
  }
}

export class BackupFailedEvent extends BaseDomainEvent {
  constructor(reason: string) {
    super('backup.failed', { reason });
  }
}
