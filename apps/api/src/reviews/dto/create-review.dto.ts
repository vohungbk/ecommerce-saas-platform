import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * `userId`/`courseId` are deliberately not fields on this DTO — the author
 * is always server-assigned from `@CurrentUser()` and the course from the
 * route param (see CourseReviewsController), never client-supplied. The
 * global ValidationPipe's `forbidNonWhitelisted: true` rejects any request
 * that includes either field with a 400.
 */
export class CreateReviewDto {
  @ApiProperty({
    description: 'Rating from 1 to 5 (inclusive)',
    minimum: 1,
    maximum: 5,
    example: 5,
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    description: 'Optional review text',
    maxLength: 2000,
    example: 'Great course, very clear explanations.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  content?: string;
}
