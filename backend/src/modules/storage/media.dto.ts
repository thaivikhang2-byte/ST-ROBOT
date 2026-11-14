import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../shared/sdk';

export class InitiateMediaDto {
  @ApiProperty() @IsUUID() lessonId!: string;
  @ApiProperty({ maxLength: 255 }) @IsString() @Length(1, 255) filename!: string;
  @ApiProperty({
    enum: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'video/mp4',
      'text/plain',
      'text/csv',
    ],
  })
  @IsString()
  @Length(1, 100)
  mimeType!: string;
  @ApiProperty({ maximum: 104857600 }) @IsInt() @Min(1) @Max(104857600) sizeBytes!: number;
  @ApiProperty({ description: 'Lowercase hexadecimal SHA-256 of the complete file' })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  checksum!: string;
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}
export class MediaQueryDto extends PaginationQueryDto {
  @ApiProperty() @IsUUID() lessonId!: string;
}
