import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, PaginationQueryDto, Permissions, RequestUser } from '../../shared/sdk';
import { ManagementDashboardService } from './dashboard.service';
import { EnrollmentPolicyDto } from './management.dto';
@ApiTags('Management Dashboards')
@ApiBearerAuth('access-token')
@Controller('v1')
export class ManagementDashboardController {
  constructor(private readonly dashboard: ManagementDashboardService) {}
  @Get('admin/dashboard')
  @Permissions('dashboard:read')
  @ApiOperation({
    summary: 'Actual system-manager statistics; missing dataset authority returns null',
  })
  overview(@CurrentUser() user: RequestUser) {
    return this.dashboard.overview(user.id);
  }
  @Get('teacher/dashboard')
  @ApiOperation({
    summary: 'Actual owned/assigned course overview; scoped teaching authority required',
  })
  teaching(@CurrentUser() user: RequestUser, @Query() query: PaginationQueryDto) {
    return this.dashboard.teaching(user.id, query);
  }
  @Get('teacher/courses')
  @ApiOperation({ summary: 'Paginated owned/assigned courses only' })
  courses(@CurrentUser() user: RequestUser, @Query() query: PaginationQueryDto) {
    return this.dashboard.courses(user.id, query);
  }
  @Get('teacher/courses/:courseId/students')
  @ApiOperation({ summary: 'Authorized course roster; excludes private email and credentials' })
  roster(
    @CurrentUser() user: RequestUser,
    @Param('courseId', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.dashboard.roster(user.id, id, query);
  }
  @Get('teacher/courses/:courseId/submissions')
  @ApiOperation({
    summary: 'Authorized grading queue; use existing quiz-attempt grading endpoints',
  })
  submissions(
    @CurrentUser() user: RequestUser,
    @Param('courseId', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.dashboard.submissions(user.id, id, query);
  }
  @Patch('teacher/courses/:courseId/enrollment-policy')
  @ApiOperation({ summary: 'Change manual enrollment policy for an owned/assigned course' })
  policy(
    @CurrentUser() user: RequestUser,
    @Param('courseId', ParseUUIDPipe) id: string,
    @Body() dto: EnrollmentPolicyDto,
  ) {
    return this.dashboard.enrollmentPolicy(user, id, dto.requireApproval);
  }
  @Get('admin/users/:id/authorization')
  @Permissions('users:read')
  @ApiOperation({ summary: 'Role assignment metadata only; no authentication secrets' })
  authorization(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.userAuthorization(id);
  }
  @Get('admin/audit')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Paginated event metadata without sensitive old/new payloads' })
  audit(@Query() query: PaginationQueryDto) {
    return this.dashboard.history(query);
  }
  @Get('admin/users/:id/history')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Account event metadata' })
  history(@Query() query: PaginationQueryDto, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.history(query, id);
  }
  @Get('admin/roles/:id/history')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Role change history retained after archiving' })
  roleHistory(@Query() query: PaginationQueryDto, @Param('id', ParseUUIDPipe) id: string) {
    return this.dashboard.history(query, undefined, id);
  }
}
