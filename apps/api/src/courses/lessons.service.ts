import { Injectable, NotFoundException } from '@nestjs/common';
import { Lesson, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from './courses.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
  ) {}

  async create(courseId: string, dto: CreateLessonDto): Promise<Lesson> {
    await this.coursesService.findOne(courseId);

    return this.prisma.lesson.create({
      data: {
        courseId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
      },
    });
  }

  async findAllForCourse(courseId: string): Promise<Lesson[]> {
    await this.coursesService.findOne(courseId);

    return this.prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async findOne(courseId: string, lessonId: string): Promise<Lesson> {
    await this.coursesService.findOne(courseId);

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, courseId },
    });

    if (!lesson) {
      throw new NotFoundException('Lesson not found');
    }

    return lesson;
  }

  async update(
    courseId: string,
    lessonId: string,
    dto: UpdateLessonDto,
  ): Promise<Lesson> {
    await this.findOne(courseId, lessonId);

    const data: Prisma.LessonUpdateInput = {};
    // `null` is treated the same as "field not present" — see
    // CoursesService.update for the rationale (mirrored here for symmetry).
    if (dto.title != null) {
      data.title = dto.title.trim();
    }
    if (dto.description != null) {
      data.description = dto.description.trim();
    }

    // Using `id: lessonId` alone here is safe only because the preceding
    // `findOne` call already proved this lesson belongs to `courseId`.
    return this.prisma.lesson.update({ where: { id: lessonId }, data });
  }
}
