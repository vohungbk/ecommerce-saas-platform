import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Category name',
    minLength: 2,
    maxLength: 100,
    example: 'Web Development',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  name: string;
}
