import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, PaginationQueryDto, Permissions, RequestUser } from '../../shared/sdk';
import { RoleManagementService } from './role-management.service';
import { ApprovalService } from './approval.service';
import {
  ApprovalCreateDto,
  ApprovalDecisionDto,
  ApprovalQueryDto,
  AssignmentDto,
  ManagedRoleDto,
  DelegationPolicyDto,
} from './management.dto';
@ApiTags('Dynamic Authorization')
@ApiBearerAuth('access-token')
@Controller('v1/admin')
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class ManagementController {
  constructor(
    private readonly roles: RoleManagementService,
    private readonly approvals: ApprovalService,
  ) {}
  @Get('roles')
  @Permissions('roles:manage')
  @ApiOperation({ summary: 'Paginated roles, explicit groups and permission relationships' })
  list(@Query() query: PaginationQueryDto) {
    return this.roles.roles(query);
  }
  @Get('roles/delegable')
  @Permissions('roles:delegate')
  @ApiOperation({ summary: 'Only current delegable permissions and scope policies' })
  delegable(@CurrentUser() user: RequestUser) {
    return this.roles.delegable(user.id);
  }
  @Post('roles')
  @Permissions('roles:manage')
  @ApiOperation({ summary: 'Create a scoped custom role within delegation authority' })
  create(@Body() dto: ManagedRoleDto, @CurrentUser() user: RequestUser) {
    return this.roles.save(dto, user.id);
  }
  @Post('roles/preview')
  @Permissions('roles:manage')
  @ApiOperation({ summary: 'Preview a new custom role; no assignment or authority is granted' })
  previewNew(@Body() dto: ManagedRoleDto, @CurrentUser() user: RequestUser) {
    return this.roles.save(dto, user.id, undefined, true);
  }
  @Post('roles/:id/preview')
  @Permissions('roles:manage')
  @ApiOperation({
    summary: 'Non-authoritative preview; mutations revalidate revision and authority',
  })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagedRoleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.roles.save(dto, user.id, id, true);
  }
  @Patch('roles/:id')
  @Permissions('roles:manage')
  @ApiOperation({ summary: 'Update custom role using revision check; archive preserves history' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManagedRoleDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.roles.save(dto, user.id, id);
  }
  @Post('role-assignments')
  @Permissions('roles:assign')
  @ApiOperation({
    summary: 'Assign student roles; teacher and manager appointments require approvals',
  })
  assign(@Body() dto: AssignmentDto, @CurrentUser() user: RequestUser) {
    return this.roles.assign(dto, user.id);
  }
  @Delete('role-assignments/:id')
  @Permissions('roles:assign')
  @ApiOperation({ summary: 'Revoke a scoped assignment immediately; no hard delete' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.roles.revoke(id, user.id);
  }
  @Get('delegations')
  @Permissions('roles:delegate')
  @ApiOperation({ summary: 'Own explicit delegation policy history' })
  policies(@CurrentUser() user: RequestUser) {
    return this.roles.policies(user.id);
  }
  @Post('delegations')
  @Permissions('roles:delegate')
  @ApiOperation({
    summary:
      'Protected administrator grants bounded policy to an already approved manager; no operational permissions granted',
  })
  policy(@CurrentUser() user: RequestUser, @Body() dto: DelegationPolicyDto) {
    return this.roles.policy(dto, user.id);
  }
  @Delete('delegations/:id')
  @Permissions('roles:delegate')
  @ApiOperation({ summary: 'Protected administrator revokes delegation authority immediately' })
  revokePolicy(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.revokePolicy(id, user.id);
  }
  @Get('approvals')
  @ApiOperation({
    summary:
      'Requests visible to requester, beneficiary or currently authorized independent approver',
  })
  requests(@CurrentUser() user: RequestUser, @Query() query: ApprovalQueryDto) {
    return this.approvals.list(user.id, query);
  }
  @Post('approvals')
  @ApiOperation({
    summary:
      'Teacher self-application, protected staff appointment or policy-controlled enrollment request',
  })
  request(@CurrentUser() user: RequestUser, @Body() dto: ApprovalCreateDto) {
    return this.approvals.create(dto, user.id);
  }
  @Get('approvals/:id')
  @ApiOperation({ summary: 'Authorized request details and durable decision history' })
  detail(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.detail(id, user.id);
  }
  @Post('approvals/:id/approve')
  @ApiOperation({
    summary: 'Independent approval; rechecks every prior approver and grants only at threshold',
  })
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.decide(id, user.id, true, dto.reason);
  }
  @Post('approvals/:id/reject')
  @ApiOperation({ summary: 'Reject pending request without granting privileges' })
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.decide(id, user.id, false, dto.reason);
  }
  @Post('approvals/:id/cancel')
  @ApiOperation({ summary: 'Requester cancels an unfinished request' })
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.cancel(id, user.id);
  }
}
