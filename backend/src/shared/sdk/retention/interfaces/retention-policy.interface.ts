// ═══════════════════════════════════════════
// Retention SDK — Retention Policy Interface
// ═══════════════════════════════════════════

export interface IRetentionPolicy {
  modelName: string;
  retentionDays: number;
  dateField: string; // e.g., 'created_at' or 'deleted_at'
  description: string;
}

export const DEFAULT_RETENTION_POLICIES: IRetentionPolicy[] = [
  {
    modelName: 'auditLog',
    retentionDays: 365,
    dateField: 'created_at',
    description: 'Audit logs',
  },
  {
    modelName: 'analyticsEvent',
    retentionDays: 180,
    dateField: 'created_at',
    description: 'Analytics events',
  },
  {
    modelName: 'refreshToken',
    retentionDays: 0, // Immediate cleanup of expired tokens
    dateField: 'expires_at',
    description: 'Expired refresh tokens',
  },
  {
    modelName: 'videoSession',
    retentionDays: 0,
    dateField: 'expires_at',
    description: 'Expired video sessions',
  },
  {
    modelName: 'notification',
    retentionDays: 90,
    dateField: 'created_at',
    description: 'Old notifications',
  },
];
