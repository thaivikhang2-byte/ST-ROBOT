import {
  IsString,
  MinLength,
  MaxLength,
  ValidateIf,
  IsInt,
  Min,
  IsIn,
  IsUUID,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../shared/sdk';

export class CourseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Administrative lists only; teachers remain limited to their own courses',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  creatorId?: string;
}

export class CreateCourseDto {
  @ApiProperty({ example: 'Introduction to Robotics' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Learn the basics of robotics with hands-on projects' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/thumbnail.jpg' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  thumbnailUrl?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  categoryId?: string;
}

export class UpdateCourseDto {
  @ApiPropertyOptional({ example: 'Advanced Robotics' })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(20000)
  description?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  thumbnailUrl?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['draft', 'published', 'archived'])
  status?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  categoryId?: string | null;
}
