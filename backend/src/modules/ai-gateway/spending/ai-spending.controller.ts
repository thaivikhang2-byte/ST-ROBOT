import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Permissions, RequestUser, Roles } from '../../../shared/sdk';
import { VaultAdminService } from '../vault/vault-admin.service';
import { AiSpendingDto } from './ai-spending.dto';
import { AiSpendingService } from './ai-spending.service';

@ApiTags('AI spending limits')
@ApiBearerAuth('access-token')
@Controller('v1/admin/ai/spending')
@Roles('admin', 'superadmin')
@Permissions('ai:manage')
export class AiSpendingController {
  constructor(private readonly spending: AiSpendingService, private readonly vault: VaultAdminService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@CurrentUser() actor: RequestUser) { return this.spending.status(actor); }

  @Put()
  @Header('Cache-Control', 'private, no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  configure(@CurrentUser() actor: RequestUser, @Body() dto: AiSpendingDto, @Req() request: Request) {
    this.vault.assertTls(request);
    return this.spending.configure(actor, dto);
  }
}
