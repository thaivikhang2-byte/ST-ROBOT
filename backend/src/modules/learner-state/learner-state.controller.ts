import { Body, Controller, Get, Header, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, PaginationQueryDto, Permissions, RequestUser } from '../../shared/sdk';
import { LearnerActivityDto, LearnerManagementQueryDto, SaveLearnerStateDto } from './learner-state.dto';
import { LearnerStateService } from './learner-state.service';

@ApiTags('Learner account synchronization')
@ApiBearerAuth('access-token')
@Controller('v1/learner-state')
export class LearnerStateController {
  constructor(private readonly state: LearnerStateService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Permissions('learning:read')
  @ApiOperation({ summary: 'Own account snapshot; synchronized browser reports are not independently verified grades' })
  get(@CurrentUser() actor: RequestUser) { return this.state.get(actor); }

  @Put()
  @Header('Cache-Control', 'no-store')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Replace own allowlisted storage snapshot using optimistic revision; stale revision returns 409' })
  save(@CurrentUser() actor: RequestUser, @Body() dto: SaveLearnerStateDto) { return this.state.save(actor, dto); }

  @Get('activity')
  @Header('Cache-Control', 'no-store')
  @Permissions('learning:read')
  history(@CurrentUser() actor: RequestUser, @Query() query: PaginationQueryDto) { return this.state.history(actor, query); }

  @Post('activity')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  activity(@CurrentUser() actor: RequestUser, @Body() dto: LearnerActivityDto) { return this.state.activity(actor, dto); }

  @Get('management')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Verified manager/assigned-teacher summaries, scoped on the server; never returns journals, assessment archives, projects or auth data' })
  management(@CurrentUser() actor: RequestUser, @Query() query: LearnerManagementQueryDto) { return this.state.management(actor, query); }
}
