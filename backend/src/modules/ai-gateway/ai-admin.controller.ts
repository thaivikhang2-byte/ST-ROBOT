import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { VaultAdminService } from './vault/vault-admin.service';
import { CreateCredentialDto, ProviderConfigurationDto, VaultRevisionDto } from './vault/vault.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions, Roles } from '../../shared/sdk';
import type { RequestUser } from '../../shared/sdk';
import { AiRegistryService } from './ai-registry.service';
import { AiGatewayService } from './ai-gateway.service';
import {
  AiQuotaDto,
  AiUsageQueryDto,
  CreateAiModelDto,
  ProviderStatusDto,
  UpdateAiModelDto,
} from './ai.dto';

@ApiTags('AI Administration')
@ApiBearerAuth('access-token')
@Controller('v1/admin/ai')
@Roles('admin', 'superadmin')
@Permissions('ai:manage')
export class AiAdminController {
  constructor(
    private readonly registry: AiRegistryService,
    private readonly gateway: AiGatewayService,
    private readonly vault: VaultAdminService,
  ) {}
  @Get('providers')
  @ApiOperation({ summary: 'List safe provider configuration status' })
  providers() {
    return this.registry.providers();
  }
  @Get('vault')
  @ApiOperation({ summary: 'Redacted encrypted-vault metadata; never ciphertext or plaintext secrets' })
  vaultMetadata() { return this.vault.metadata(); }
  @Put('providers/:id/config')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'CAS update approved provider metadata; HTTPS required' })
  configure(@Param('id') id: string, @Body() dto: ProviderConfigurationDto, @CurrentUser() user: RequestUser, @Req() request: Request) {
    this.vault.assertTls(request);
    return this.vault.configure(id, dto, user.id);
  }
  @Post('providers/:id/credentials')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Encrypt a credential immediately; HTTPS required; no plaintext read endpoint' })
  credential(@Param('id') id: string, @Body() dto: CreateCredentialDto, @CurrentUser() user: RequestUser, @Req() request: Request) {
    this.vault.assertTls(request);
    return this.vault.add(id, dto, user.id);
  }
  @Delete('providers/:id/credentials/:credential')
  @ApiOperation({ summary: 'CAS remove a credential; HTTPS required' })
  removeCredential(@Param('id') id: string, @Param('credential') credential: string, @Body() dto: VaultRevisionDto, @CurrentUser() user: RequestUser, @Req() request: Request) {
    this.vault.assertTls(request);
    return this.vault.remove(id, credential, dto, user.id);
  }
  @Delete('providers/:id/config')
  @ApiOperation({ summary: 'CAS remove provider configuration and disable DB routing; usage history is retained' })
  removeProvider(@Param('id') id: string, @Body() dto: VaultRevisionDto, @CurrentUser() user: RequestUser, @Req() request: Request) {
    this.vault.assertTls(request);
    return this.vault.remove(id, undefined, dto, user.id);
  }
  @Get('providers/:id/models')
  @ApiOperation({
    summary: 'Discover up to 100 IDs from official provider metadata; never auto-enables models',
  })
  discover(@Param('id') id: string) {
    return this.registry.discover(id);
  }
  @Patch('providers/:id')
  @ApiOperation({
    summary: 'Enable/disable a built-in provider; credentials remain in server secrets',
  })
  provider(
    @Param('id') id: string,
    @Body() dto: ProviderStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.providerStatus(id, dto.enabled, user.id);
  }
  @Get('models')
  @ApiOperation({ summary: 'List enabled and disabled registry entries' })
  models(@CurrentUser() user: RequestUser) {
    return this.registry.models(user, true);
  }
  @Post('models')
  @ApiOperation({ summary: 'Register an explicit model and capability allowlist' })
  createModel(@Body() dto: CreateAiModelDto, @CurrentUser() user: RequestUser) {
    return this.registry.saveModel(dto, user.id);
  }
  @Patch('models/:id')
  @ApiOperation({ summary: 'Update a registered model; cannot invent provider capabilities' })
  model(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiModelDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.saveModel(dto, user.id, id);
  }
  @Get('quotas/default')
  @ApiOperation({ summary: 'Get default daily/user admission limits' })
  defaultQuota() {
    return this.registry.quota();
  }
  @Patch('quotas/default')
  @ApiOperation({ summary: 'Replace default quota limits; zero daily budget disables generation' })
  defaultQuotaUpdate(@Body() dto: AiQuotaDto, @CurrentUser() user: RequestUser) {
    return this.registry.saveQuota(dto, user.id);
  }
  @Get('quotas/users/:id')
  @ApiOperation({ summary: 'Get a user override; null means defaults apply' })
  quota(@Param('id', ParseUUIDPipe) id: string) {
    return this.registry.quota(id);
  }
  @Patch('quotas/users/:id')
  @ApiOperation({ summary: 'Set a user quota override' })
  quotaUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AiQuotaDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.registry.saveQuota(dto, user.id, id);
  }
  @Get('usage')
  @ApiOperation({
    summary: 'Paginated usage metadata, optionally filtered by userId; no prompts/content',
  })
  usage(@Query() query: AiUsageQueryDto) {
    return this.gateway.usage(query.userId, query);
  }
}
