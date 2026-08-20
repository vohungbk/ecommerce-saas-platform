import { Injectable } from '@nestjs/common';
import { Course, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { FindCoursesQueryDto } from './dto/find-courses-query.dto';

export interface PaginatedCourses {
  data: Course[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

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

  async findAll(query: FindCoursesQueryDto): Promise<PaginatedCourses> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.CourseWhereInput | undefined = query.status
      ? { status: query.status }
      : undefined;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.course.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
