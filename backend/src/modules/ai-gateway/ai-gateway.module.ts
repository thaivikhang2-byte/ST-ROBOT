import { Module } from '@nestjs/common';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiAdminController } from './ai-admin.controller';
import { AiRegistryService } from './ai-registry.service';
import { AiQuotaService } from './ai-quota.service';
import { ProviderClients } from './provider-clients';
import { OpenAiAdapter } from './openai.adapter';
import { AnthropicAdapter } from './anthropic.adapter';
import { AiMaintenanceService } from './ai-maintenance.service';
import { AiVaultService } from './vault/ai-vault.service';
import { ProviderTransport } from './secure-provider-fetch';
import { ProviderLeases } from './provider-leases';
import { GeminiAdapter } from './gemini.adapter';
import { CompatibleAdapter } from './compatible.adapter';
import { OpenRouterAdapter } from './openrouter.adapter';
import { WorkersAiAdapter } from './workers-ai.adapter';
import { AiCircuitBreakerService } from './ai-circuit-breaker.service';
import { VaultAdminService } from './vault/vault-admin.service';

@Module({
  controllers: [AiGatewayController, AiAdminController],
  providers: [
    AiGatewayService,
    AiRegistryService,
    AiQuotaService,
    ProviderClients,
    OpenAiAdapter,
    AnthropicAdapter,
    AiMaintenanceService,
    AiVaultService,
    ProviderTransport,
    ProviderLeases,
    GeminiAdapter,
    CompatibleAdapter,
    OpenRouterAdapter,
    WorkersAiAdapter,
    AiCircuitBreakerService,
    VaultAdminService,
  ],
  exports: [AiGatewayService, AiRegistryService, AiCircuitBreakerService],
})
export class AiGatewayModule {}
