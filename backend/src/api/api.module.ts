// ═══════════════════════════════════════════
// API Gateway — Root API Module
// Aggregates all route groups
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';
import { ApiV1Module } from './v1/api-v1.module';
import { ApiAdminModule } from './admin/api-admin.module';
import { ApiInternalModule } from './internal/api-internal.module';
import { ApiSystemModule } from './system/api-system.module';

@Module({
  imports: [
    ApiV1Module,
    ApiAdminModule,
    ApiInternalModule,
    ApiSystemModule,
  ],
})
export class ApiModule {}
