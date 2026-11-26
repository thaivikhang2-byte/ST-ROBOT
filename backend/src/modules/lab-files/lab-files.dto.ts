import { IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { LAB_CHUNK_ENCODED_LIMIT, LAB_FILE_LIMITS } from './lab-files.policy';

export class LabFileScopeDto {
  @IsString() @MaxLength(40)
  courseId!: string;

  @IsString() @MaxLength(40)
  lessonId!: string;

  @IsString() @MaxLength(30)
  platformKey!: string;
}

export class BeginLabFileUploadDto extends LabFileScopeDto {
  @IsString() @MaxLength(180)
  name!: string;

  @IsInt() @Min(0) @Max(LAB_FILE_LIMITS.fileBytes)
  sizeBytes!: number;

  @IsUUID()
  clientUploadId!: string;
}

export class UploadLabFileChunkDto {
  @IsString() @MaxLength(LAB_CHUNK_ENCODED_LIMIT)
  dataBase64!: string;
}
