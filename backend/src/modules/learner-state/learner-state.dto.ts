import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../shared/sdk';

export const learnerActions = ['lesson_opened', 'lesson_completed', 'lab_opened', 'quiz_completed', 'portfolio_saved', 'assessment_completed'] as const;

export class SaveLearnerStateDto {
  @ApiProperty({ minimum: 0, description: 'Revision returned by GET; zero for a new account snapshot' })
  @IsInt() @Min(0) @Max(2147483646)
  revision!: number;

  @ApiProperty({ description: 'Full snapshot of supported localStorage keys and their exact string values; never include auth tokens' })
  @IsObject()
  values!: Record<string, string>;
}

export class LearnerActivityDto {
  @ApiProperty({ enum: [...learnerActions] })
  @IsIn(learnerActions)
  action!: typeof learnerActions[number];

  @ApiPropertyOptional({ description: 'Canonical frontend course slug' })
  @IsOptional() @IsString() @MaxLength(40)
  courseId?: string;

  @ApiPropertyOptional({ description: 'Canonical frontend lesson slug within courseId' })
  @IsOptional() @IsString() @MaxLength(40)
  lessonId?: string;
}

export class LearnerManagementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Backend course UUID; required for a teacher with course-scoped authority' })
  @IsOptional() @IsUUID()
  courseId?: string;
}
