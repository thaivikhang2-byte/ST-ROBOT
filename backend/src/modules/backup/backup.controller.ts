import { Controller, Get, Post, HttpCode, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BackupService } from './backup.service';
import { CurrentUser, Permissions, RequestUser } from '../../shared/sdk';

@ApiTags('Backup')
@ApiBearerAuth('access-token')
@Controller('v1/admin/backups')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}
  @Get()
  @Permissions('backup:read')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Last 30 backup statuses; no secret paths or archive download' })
  list(@CurrentUser() user: RequestUser) {
    return this.backupService.list(user.id);
  }
  @Post()
  @HttpCode(202)
  @Permissions('backup:create')
  @ApiOperation({
    summary: 'Queue encrypted full snapshot; SYSTEM manager required. No restore API.',
  })
  create(@CurrentUser() user: RequestUser) {
    return this.backupService.enqueue(user.id);
  }
}
