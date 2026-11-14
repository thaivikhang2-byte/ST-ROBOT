import {
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
  IsInt,
  Min,
  IsBoolean,
  IsUUID,
  IsIn,
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLessonDto {
  @ApiProperty({ example: 'Getting Started with Arduino' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: '<p>Lesson content in HTML</p>' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80000)
  content?: string;

  @ApiProperty({ description: 'Course ID' })
  @IsUUID()
  courseId!: string;

  @ApiPropertyOptional({ default: 0 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isRequired?: boolean;
}

export class UpdateLessonDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(80000)
  content?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['draft', 'published', 'archived'])
  status?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isRequired?: boolean;
}

export class ReorderLessonsDto {
  @ApiProperty({
    type: [String],
    description: 'Complete ordered list of all non-deleted lesson UUIDs; maximum 500',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  lessonIds!: string[];
}
