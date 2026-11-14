import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MailService } from './mail.service';

@ApiTags('Mail')
@ApiBearerAuth('access-token')
@Controller('v1/mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}
}
