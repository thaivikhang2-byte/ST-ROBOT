import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Permissions, RequestUser } from '../../shared/sdk';
import { BeginLabFileUploadDto, LabFileScopeDto, UploadLabFileChunkDto } from './lab-files.dto';
import { LabFilesService } from './lab-files.service';

@ApiTags('Private learner lab files')
@ApiBearerAuth('access-token')
@Controller('v1/lab-files')
export class LabFilesController {
  constructor(private readonly files: LabFilesService) {}

  @Get()
  @Permissions('learning:read')
  list(@CurrentUser() actor: RequestUser, @Query() scope: LabFileScopeDto) { return this.files.list(actor, scope); }

  @Post('uploads')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  begin(@CurrentUser() actor: RequestUser, @Body() dto: BeginLabFileUploadDto) { return this.files.begin(actor, dto); }

  @Put(':id/chunks/:index')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 360, ttl: 60000 } })
  putChunk(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number, @Body() dto: UploadLabFileChunkDto) {
    return this.files.putChunk(actor, id, index, dto.dataBase64);
  }

  @Get(':id/chunks/:index')
  @Permissions('learning:read')
  @Throttle({ default: { limit: 360, ttl: 60000 } })
  getChunk(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number) { return this.files.getChunk(actor, id, index); }

  @Post(':id/complete')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  complete(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.files.complete(actor, id); }

  @Delete(':id')
  @Permissions('learning:update')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  remove(@CurrentUser() actor: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.files.remove(actor, id); }
}
