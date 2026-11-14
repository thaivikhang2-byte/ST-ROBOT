import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../shared/sdk';

const optional = (_: unknown, value: unknown) => value !== undefined;
export class QuizOptionDto {
  @ApiProperty() @IsString() @Matches(/^[a-zA-Z0-9_-]{1,40}$/) id!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) text!: string;
  @ApiProperty() @IsBoolean() isCorrect!: boolean;
}
export class QuizQuestionDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(8000) text!: string;
  @ApiProperty({
    enum: ['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'open_ended'],
  })
  @IsIn(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'open_ended'])
  type!: string;
  @ApiProperty({ minimum: 0.01, maximum: 10000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10000)
  points!: number;
  @ApiPropertyOptional({ type: [QuizOptionDto] })
  @ValidateIf(optional)
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QuizOptionDto)
  options?: QuizOptionDto[];
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf(optional)
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  acceptedAnswers?: string[];
  @ApiPropertyOptional() @ValidateIf(optional) @IsBoolean() caseSensitive?: boolean;
  @ApiPropertyOptional() @ValidateIf(optional) @IsString() @MaxLength(8000) explanation?: string;
  @ApiPropertyOptional() @ValidateIf(optional) @IsString() @MaxLength(8000) gradingRubric?: string;
}
export class CreateQuizDto {
  @ApiProperty() @IsUUID() lessonId!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(255) title!: string;
  @ApiPropertyOptional() @ValidateIf(optional) @IsString() @MaxLength(8000) description?: string;
  @ApiPropertyOptional({ default: 70 })
  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(100)
  passScore?: number;
  @ApiPropertyOptional({ description: 'Minutes; null removes time limit', nullable: true })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(1440)
  timeLimit?: number | null;
  @ApiPropertyOptional({ default: 0, description: 'Lifetime starts per student; 0 = unlimited' })
  @ValidateIf(optional)
  @IsInt()
  @Min(0)
  @Max(1000)
  maxAttempts?: number;
  @ApiPropertyOptional() @ValidateIf(optional) @IsBoolean() requiresPass?: boolean;
  @ApiPropertyOptional() @ValidateIf(optional) @IsBoolean() reviewAnswers?: boolean;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsDateString()
  availableFrom?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsDateString()
  availableUntil?: string | null;
  @ApiProperty({ type: [QuizQuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  questions!: QuizQuestionDto[];
}
export class UpdateQuizDto extends PartialType(OmitType(CreateQuizDto, ['lessonId'] as const), {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] })
  @ValidateIf(optional)
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
}
export class QuizListDto extends PaginationQueryDto {
  @ApiProperty() @IsUUID() lessonId!: string;
}
export class QuizAnswerDto {
  @ApiProperty() @IsUUID() questionId!: string;
  @ApiPropertyOptional({ type: [String] })
  @ValidateIf(optional)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  optionIds?: string[];
  @ApiPropertyOptional() @ValidateIf(optional) @IsString() @MaxLength(10000) text?: string;
}
export class SubmitQuizDto {
  @ApiProperty({ type: [QuizAnswerDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuizAnswerDto)
  answers!: QuizAnswerDto[];
}
export class ManualGradeAnswerDto {
  @ApiProperty() @IsUUID() questionId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000) points!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) feedback!: string;
}
export class ManualGradeDto {
  @ApiProperty({ type: [ManualGradeAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ManualGradeAnswerDto)
  answers!: ManualGradeAnswerDto[];
}
