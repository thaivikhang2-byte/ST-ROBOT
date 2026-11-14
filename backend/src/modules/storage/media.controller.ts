import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Permissions, RequestUser } from '../../shared/sdk';
import { MediaService } from './media.service';
import { InitiateMediaDto, MediaQueryDto } from './media.dto';
import {
  MediaAssetResponseDto,
  InitiatedMediaResponseDto,
  MediaDownloadResponseDto,
} from './media-response.dto';

@ApiTags('Media')
@ApiExtraModels(MediaAssetResponseDto, InitiatedMediaResponseDto, MediaDownloadResponseDto)
@ApiBearerAuth('access-token')
@ApiResponse({ status: 401, description: 'Missing, invalid or revoked identity/session' })
@ApiResponse({ status: 403, description: 'Current permission, ownership or enrollment required' })
@ApiResponse({ status: 503, description: 'Storage is unconfigured, unavailable or inconsistent' })
@Controller('v1/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}
  @Post('uploads')
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { $ref: getSchemaPath(InitiatedMediaResponseDto) },
      },
    },
  })
  @Permissions('uploads:create')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Reserve lesson upload; verified owner, max 10 pending uploads, 20/min',
    description:
      'PUT the exact bytes to upload.url with returned headers. The object remains private and undeliverable until complete succeeds.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid MIME, filename, SHA-256 or configured size limit',
  })
  initiate(@Body() dto: InitiateMediaDto, @CurrentUser() actor: RequestUser) {
    return this.media.initiate(dto, actor);
  }
  @Post('uploads/:id/complete')
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: { data: { $ref: getSchemaPath(MediaAssetResponseDto) } },
    },
  })
  @Permissions('uploads:create')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Verify stored size, MIME, SHA-256 and signature; promote immutable ready object',
    description:
      'Idempotent after READY; concurrent verification, missing upload or expiry returns 409. Invalid bytes return 400 and fail the upload. No client success flag is accepted.',
  })
  @ApiResponse({ status: 409, description: 'Expired, missing, busy or unavailable upload' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.media.complete(id, actor);
  }
  @Get()
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: { $ref: getSchemaPath(MediaAssetResponseDto) } },
        meta: { type: 'object', properties: { pagination: { type: 'object' } } },
      },
    },
  })
  @Permissions('uploads:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List lesson media in display order; learners see READY only',
    description:
      'Active enrollment and published content required for learners. Verified owners/admins with upload permission may inspect draft media.',
  })
  list(@Query() query: MediaQueryDto, @CurrentUser() actor: RequestUser) {
    return this.media.list(query, actor);
  }
  @Get(':id')
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: { data: { $ref: getSchemaPath(MediaAssetResponseDto) } },
    },
  })
  @Permissions('uploads:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Authorized media metadata without storage keys or credentials' })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.media.get(id, actor);
  }
  @Post(':id/download')
  @ApiResponse({
    status: 201,
    schema: {
      type: 'object',
      properties: { data: { $ref: getSchemaPath(MediaDownloadResponseDto) } },
    },
  })
  @Permissions('uploads:read')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Issue private signed S3 download/playback URL, maximum 300 seconds',
    description:
      'Rechecks identity, publication and enrollment/ownership. PDFs/text are attachments; images/MP4 inline. Existing grants expire within configured TTL after revocation; this is not DRM.',
  })
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.media.download(id, actor);
  }
  @Delete(':id')
  @Permissions('uploads:delete')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Soft-delete owned lesson media; background storage cleanup retries safely',
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: RequestUser) {
    return this.media.remove(id, actor);
  }
}
