import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StorageService } from './storage.service';

@ApiTags('Storage')
@ApiBearerAuth('access-token')
@Controller('v1/storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}
}
