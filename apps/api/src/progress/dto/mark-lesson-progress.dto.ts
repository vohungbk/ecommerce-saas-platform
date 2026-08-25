import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class MarkLessonProgressDto {
  @ApiProperty({
    description: 'Whether the lesson is completed',
    example: true,
  })
  @IsBoolean()
  completed: boolean;
}
