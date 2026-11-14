import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';

export class LearnerOptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() text!: string;
}
export class LearnerQuestionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() text!: string;
  @ApiProperty({
    enum: ['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'open_ended'],
  })
  type!: string;
  @ApiProperty() points!: number;
  @ApiProperty({ type: [LearnerOptionResponseDto] }) options!: LearnerOptionResponseDto[];
  @ApiPropertyOptional({
    type: [String],
    description: 'Only after final grading when the captured review policy allows it',
  })
  correctOptionIds?: string[];
  @ApiPropertyOptional({ type: [String], description: 'Only after permitted final review' })
  acceptedAnswers?: string[];
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Only after permitted final review',
  })
  explanation?: string | null;
}
export class AttemptAnswerResponseDto {
  @ApiProperty({ format: 'uuid' }) questionId!: string;
  @ApiProperty({
    type: Object,
    description: 'Submitted questionId with optionIds or text; never a grading key',
  })
  answer!: object;
  @ApiProperty({ type: Number, nullable: true }) points!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) isCorrect!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) feedback!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) gradedAt!: string | null;
}
export class QuizAttemptResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) quizId!: string;
  @ApiProperty() quizRevision!: number;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['in_progress', 'pending_grading', 'graded', 'expired'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deadlineAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) gradedAt!: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null until all objective and manual grades are final',
  })
  score!: number | null;
  @ApiProperty() maxScore!: number;
  @ApiProperty({ type: Number, nullable: true }) percentage!: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) isPassed!: boolean | null;
  @ApiProperty({ type: [LearnerQuestionResponseDto] }) questions!: LearnerQuestionResponseDto[];
  @ApiProperty({
    type: [AttemptAnswerResponseDto],
    description: 'Empty while in progress or expired',
  })
  answers!: AttemptAnswerResponseDto[];
}
export const attemptResponseSchema = {
  type: 'object' as const,
  properties: {
    success: { type: 'boolean' as const },
    message: { type: 'string' as const },
    data: { $ref: getSchemaPath(QuizAttemptResponseDto) },
  },
};
