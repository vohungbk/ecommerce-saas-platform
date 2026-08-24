import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * `courseId`/`id` are deliberately not fields on this DTO — a lesson's id
 * and the course it belongs to are never client-editable via this endpoint
 * (moving a lesson to a different course is not supported). The global
 * ValidationPipe's `forbidNonWhitelisted: true` rejects any request that
 * includes either field with a 400.
 */
export class UpdateLessonDto {
  @ApiPropertyOptional({
    description: 'Lesson title',
    minLength: 3,
    maxLength: 200,
    example: 'Setting up your environment',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

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
