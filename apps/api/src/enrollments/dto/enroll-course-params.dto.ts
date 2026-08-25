import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class EnrollCourseParamsDto {
  @ApiProperty({
    description: 'Course id',
    example: 'cljk3x9a10000qzrmn831p5n2',
  })
  // Trimmed the same way FindCourseLessonsParamsDto.courseId is, so a
  // whitespace-only id is rejected by IsNotEmpty (which only checks
  // `!== ''`, not blank strings) rather than silently passing validation.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  courseId: string;
}
