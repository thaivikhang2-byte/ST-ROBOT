import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsUUID,
  IsString,
  IsIn,
  IsOptional,
  Length,
  Matches,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
export class VideoUploadDto {
  @ApiProperty() @IsUUID() lessonId!: string;
  @ApiProperty() @IsString() @Length(1, 255) filename!: string;
  @ApiProperty({ enum: ['video/mp4', 'video/quicktime'] })
  @IsIn(['video/mp4', 'video/quicktime'])
  mimeType!: string;
  @ApiProperty({ maximum: 536870912 }) @IsInt() @Min(1) @Max(536870912) sizeBytes!: number;
  @ApiProperty({ description: 'SHA-256 of source; checked by local worker' })
  @Matches(/^[a-f0-9]{64}$/)
  checksum!: string;
}
export class VideoQueryDto {
  @ApiProperty() @IsUUID() lessonId!: string;
}
export class VideoMetadataDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @ApiPropertyOptional({ minimum: 50, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(100)
  completionPercent?: number;
}
export class VideoProgressDto {
  @ApiProperty({ description: 'Seconds, server duration is authoritative' })
  @IsInt()
  @Min(0)
  @Max(14400)
  positionSeconds!: number;
  @ApiProperty({ description: 'Compare-and-swap version returned by GET progress' })
  @IsInt()
  @Min(0)
  version!: number;
}
export class ArchiveVideoDto {
  @ApiProperty({ description: 'Explicit archive confirmation; source/history retained' })
  @IsBoolean()
  confirm!: boolean;
}

export class PurgeProviderVideoDto {
  @ApiProperty({ description: 'Must match the archived video ID; irreversible remote deletion' })
  @IsUUID()
  confirmVideoId!: string;
  @ApiProperty({ description: 'Operator reason recorded in security audit' })
  @IsString()
  @Length(20, 1000)
  reason!: string;
}
