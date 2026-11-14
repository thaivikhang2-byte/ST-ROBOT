import { Controller, Get, Patch, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, PaginationQueryDto, RequestUser } from '../../shared/sdk';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}
  @Get()
  @ApiOperation({ summary: 'Current account in-app notifications only' })
  list(@CurrentUser() user: RequestUser, @Query() query: PaginationQueryDto) {
    return this.notificationsService.list(user.id, query);
  }
  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark own notification as read' })
  read(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.read(user.id, id);
  }
}
