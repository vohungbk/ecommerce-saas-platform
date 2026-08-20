import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

/**
 * `status` is deliberately not a field on this DTO — course status is
 * always server-assigned to `DRAFT` on creation (see CoursesService) and
 * can never be supplied by the client. The global ValidationPipe's
 * `forbidNonWhitelisted: true` rejects any request that includes a
 * `status` field with a 400.
 */
export class CreateCourseDto {
  @ApiProperty({
    description: 'Course title',
    minLength: 3,
    maxLength: 200,
    example: 'Intro to TypeScript',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 200)
  title: string;

  @ApiPropertyOptional({
    description: 'Course description',
    example: 'A beginner course covering TypeScript fundamentals.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  description?: string;
}
