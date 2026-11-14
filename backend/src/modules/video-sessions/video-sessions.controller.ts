import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VideoSessionsService } from './video-sessions.service';

@ApiTags('Video Sessions')
@ApiBearerAuth('access-token')
@Controller('v1/video-sessions')
export class VideoSessionsController {
  constructor(private readonly videoSessionsService: VideoSessionsService) {}
}
