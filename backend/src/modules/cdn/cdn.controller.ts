import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CdnService } from './cdn.service';

@ApiTags('Cdn')
@ApiBearerAuth('access-token')
@Controller('v1/cdn')
export class CdnController {
  constructor(private readonly cdnService: CdnService) {}
}
