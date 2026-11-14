import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { RoleManagementService } from './role-management.service';
import { ApprovalService } from './approval.service';
import { ManagementController } from './management.controller';
import { ManagementDashboardService } from './dashboard.service';
import { ManagementDashboardController } from './dashboard.controller';
@Global()
@Module({
  controllers: [ManagementController, ManagementDashboardController],
  providers: [
    AuthorizationService,
    RoleManagementService,
    ApprovalService,
    ManagementDashboardService,
  ],
  exports: [
    AuthorizationService,
    RoleManagementService,
    ApprovalService,
    ManagementDashboardService,
  ],
})
export class AuthorizationModule {}
