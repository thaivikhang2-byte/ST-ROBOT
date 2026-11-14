import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth('access-token')
@Controller('v1/search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}
}
