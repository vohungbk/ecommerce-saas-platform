import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * `userId`/`courseId` are deliberately not fields on this DTO — same reason
 * as CreateReviewDto. Both fields are optional here (mirrors UpdateCourseDto
 * — no route in this codebase requires "at least 1 field" on a PATCH).
 */
export class UpdateReviewDto {
  @ApiPropertyOptional({
    description: 'Rating from 1 to 5 (inclusive)',
    minimum: 1,
    maximum: 5,
    example: 4,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

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
