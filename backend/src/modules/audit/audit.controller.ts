import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth('access-token')
@Controller('v1/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}
}
