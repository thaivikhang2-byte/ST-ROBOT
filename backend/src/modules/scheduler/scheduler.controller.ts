import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';

@ApiTags('Scheduler')
@ApiBearerAuth('access-token')
@Controller('v1/scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}
}
