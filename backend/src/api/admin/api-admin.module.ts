// ═══════════════════════════════════════════
// API Gateway — Admin Route Group
// /api/admin/* — Admin panel endpoints
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';

@Module({
  imports: [
    // Admin-specific modules:
    // DashboardModule,
    // AuditModule,
    // SettingsModule,
    // FeatureFlagsModule,
    // ApiKeysModule,
    // BackupModule,
  ],
})
export class ApiAdminModule {}
