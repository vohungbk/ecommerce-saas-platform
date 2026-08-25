import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReorderLessonItemDto {
  @ApiProperty({
    description: 'Lesson id',
    example: 'cljk3x9a10000qzrmn831p5n2',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'New 1-based position for this lesson within its course',
    minimum: 1,
    example: 1,
  })
  @IsInt()
  @Min(1)
  position: number;
}

export class ReorderLessonsDto {
  @ApiProperty({
    description:
      "The full, reordered list of the course's lessons. Must include every lesson currently belonging to the course, each with a unique target position.",
    type: [ReorderLessonItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReorderLessonItemDto)
  lessons: ReorderLessonItemDto[];
}
