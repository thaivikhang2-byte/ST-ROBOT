import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentUser, Permissions, RequestUser } from '../../shared/sdk';
import { SystemService } from './system.service';
@ApiTags('Operations')
@ApiBearerAuth('access-token')
@Controller('v1/admin/operations')
export class SystemController {
  constructor(private readonly system: SystemService) {}
  @Get()
  @Permissions('system:read')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Current SYSTEM manager diagnostics; additional dataset permissions required for AI, learning and backups',
  })
  snapshot(@CurrentUser() user: RequestUser) {
    return this.system.snapshot(user.id);
  }
}
