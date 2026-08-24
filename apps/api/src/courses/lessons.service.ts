import { Injectable, NotFoundException } from '@nestjs/common';
import { Lesson } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from './courses.service';
import { CreateLessonDto } from './dto/create-lesson.dto';

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
}
