import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Lesson, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from './courses.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { ReorderLessonsDto } from './dto/reorder-lessons.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
  ) {}

  async create(courseId: string, dto: CreateLessonDto): Promise<Lesson> {
    await this.coursesService.findOne(courseId);

    return this.prisma.$transaction(async (tx) => {
      const { _max } = await tx.lesson.aggregate({
        where: { courseId },
        _max: { position: true },
      });

      return tx.lesson.create({
        data: {
          courseId,
          title: dto.title.trim(),
          description: dto.description?.trim(),
          position: (_max.position ?? 0) + 1,
        },
      });
    });
  }

  async findAllForCourse(courseId: string): Promise<Lesson[]> {
    await this.coursesService.findOne(courseId);

    return this.prisma.lesson.findMany({
      where: { courseId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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

  async remove(courseId: string, lessonId: string): Promise<Lesson> {
    const lesson = await this.findOne(courseId, lessonId);

    return this.prisma.lesson.delete({ where: { id: lesson.id } });
  }

  async reorder(courseId: string, dto: ReorderLessonsDto): Promise<Lesson[]> {
    await this.coursesService.findOne(courseId);

    const ids = dto.lessons.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Duplicate lesson id in reorder payload');
    }

    const positions = dto.lessons.map((item) => item.position);
    if (new Set(positions).size !== positions.length) {
      throw new BadRequestException('Duplicate position in reorder payload');
    }

    const existing = await this.prisma.lesson.findMany({
      where: { courseId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((lesson) => lesson.id));
    const payloadIds = new Set(ids);

    for (const id of payloadIds) {
      if (!existingIds.has(id)) {
        throw new NotFoundException('Lesson not found');
      }
    }

    if (existingIds.size !== payloadIds.size) {
      throw new BadRequestException(
        "Reorder payload must include all of the course's lessons",
      );
    }

    await this.prisma.$transaction(
      dto.lessons.map((item) =>
        this.prisma.lesson.update({
          where: { id: item.id },
          data: { position: item.position },
        }),
      ),
    );

    return this.findAllForCourse(courseId);
  }
}
