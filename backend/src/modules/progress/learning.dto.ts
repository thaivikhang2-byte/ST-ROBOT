import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class UpdateLearningProgressDto {
  @ApiProperty({
    enum: ['in_progress', 'completed'],
    description: 'Server timestamps and quiz completion policy apply; clients cannot reset history',
  })
  @IsIn(['in_progress', 'completed'])
  status!: 'in_progress' | 'completed';
}
