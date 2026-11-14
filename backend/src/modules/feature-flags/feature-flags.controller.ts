import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import { PaginationQueryDto } from '../../shared/sdk';

@ApiTags('Feature Flags')
@ApiBearerAuth('access-token')
@Controller('v1/feature-flags')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @ApiOperation({ summary: 'List all feature-flags' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.featureFlagsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get feature-flags by id' })
  findOne(@Param('id') id: string) {
    return this.featureFlagsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create feature-flags' })
  create(@Body() dto: any) {
    return this.featureFlagsService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update feature-flags' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.featureFlagsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete feature-flags' })
  remove(@Param('id') id: string) {
    return this.featureFlagsService.delete(id);
  }
}
