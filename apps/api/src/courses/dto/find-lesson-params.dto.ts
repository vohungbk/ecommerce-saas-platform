import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class FindLessonParamsDto {
  @ApiProperty({
    description: 'Course id',
    example: 'cljk3x9a10000qzrmn831p5n2',
  })
  // Trimmed the same way FindCourseParamsDto.id is (see
  // find-course-params.dto.ts) so a whitespace-only id is rejected by
  // IsNotEmpty (which only checks `!== ''`, not blank strings) rather
  // than silently passing validation and surfacing as a 404 instead of
  // the 400 required by the acceptance criteria.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @ApiProperty({
    description: 'Lesson id',
    example: 'cljk3xagj0001qzrm12abcd34',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  lessonId: string;
}
