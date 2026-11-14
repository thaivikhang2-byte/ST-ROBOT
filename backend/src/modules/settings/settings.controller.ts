import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { PaginationQueryDto } from '../../shared/sdk';

@ApiTags('Settings')
@ApiBearerAuth('access-token')
@Controller('v1/settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'List all settings' })
  findAll(@Query() query: PaginationQueryDto) {
    return this.settingsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get settings by id' })
  findOne(@Param('id') id: string) {
    return this.settingsService.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create settings' })
  create(@Body() dto: any) {
    return this.settingsService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update settings' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.settingsService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete settings' })
  remove(@Param('id') id: string) {
    return this.settingsService.delete(id);
  }
}
