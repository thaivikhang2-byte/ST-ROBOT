import { ApiProperty } from '@nestjs/swagger';

export class MediaAssetResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) lessonId!: string;
  @ApiProperty() filename!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty({ maximum: 104857600 }) sizeBytes!: number;
  @ApiProperty({
    enum: ['pending', 'uploading', 'verifying', 'ready', 'failed', 'deleted', 'legacy'],
  })
  status!: string;
  @ApiProperty({ enum: ['image', 'document', 'video', 'download'] }) resourceType!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ format: 'uuid', nullable: true }) videoId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({
    example: 'not_scanned',
    description: 'File signatures/checksums do not imply malware scanning',
  })
  scanStatus!: string;
}
class UploadGrantDto {
  @ApiProperty({ description: 'Bearer capability: do not log or persist' }) url!: string;
  @ApiProperty({ example: 'PUT' }) method!: string;
  @ApiProperty({ example: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' } })
  headers!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}
export class InitiatedMediaResponseDto extends MediaAssetResponseDto {
  @ApiProperty({ type: UploadGrantDto }) upload!: UploadGrantDto;
}
export class MediaDownloadResponseDto {
  @ApiProperty({ description: 'Expiring bearer URL, never an unprotected CDN rewrite' })
  url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
  @ApiProperty() mimeType!: string;
  @ApiProperty() filename!: string;
  @ApiProperty({ example: 'signed-s3' }) delivery!: string;
  @ApiProperty({ example: 'private, no-store' }) cacheControl!: string;
}
