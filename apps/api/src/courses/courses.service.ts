import { Injectable } from '@nestjs/common';
import { Course } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCourseDto): Promise<Course> {
    return this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        status: 'DRAFT',
      },
    });
  }
}
