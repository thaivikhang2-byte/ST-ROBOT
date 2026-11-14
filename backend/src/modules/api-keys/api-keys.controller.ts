import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeysService } from './api-keys.service';
import { PaginationQueryDto } from '../../shared/sdk';

@ApiTags('Api Keys')
@ApiBearerAuth('access-token')
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: 'List all api-keys' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.apiKeysService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get api-keys by id' })
  findOne(@Param('id') id: string) {
    return this.apiKeysService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create api-keys' })
  create(@Body() dto: any) {
    return this.apiKeysService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update api-keys' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.apiKeysService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete api-keys' })
  remove(@Param('id') id: string) {
    return this.apiKeysService.delete(id);
  }
}
