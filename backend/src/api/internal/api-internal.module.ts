// ═══════════════════════════════════════════
// API Gateway — Internal Route Group
// /api/internal/* — Service-to-service calls
// ═══════════════════════════════════════════

import { Module } from '@nestjs/common';

@Module({
  imports: [
    // Internal endpoints (AI Service ↔ Backend, etc.):
    // AiGatewayModule,
    // FileProcessingModule,
  ],
})
export class ApiInternalModule {}
