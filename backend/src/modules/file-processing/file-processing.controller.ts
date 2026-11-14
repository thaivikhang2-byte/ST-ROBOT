import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FileProcessingService } from './file-processing.service';

@ApiTags('File Processing')
@ApiBearerAuth('access-token')
@Controller('v1/file-processing')
export class FileProcessingController {
  constructor(private readonly fileProcessingService: FileProcessingService) {}
}
