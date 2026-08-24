import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateLessonDto {
  @ApiProperty({
    description: 'Lesson title',
    minLength: 3,
    maxLength: 200,
    example: 'Setting up your environment',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 200)
  title: string;

  @ApiPropertyOptional({
    description: 'Lesson description',
    example: 'How to install the tools needed for this course.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  description?: string;
}
