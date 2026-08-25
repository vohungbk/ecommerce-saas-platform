import { Injectable, NotFoundException } from '@nestjs/common';
import { LessonProgress } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';
import { LessonsService } from '../courses/lessons.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly lessonsService: LessonsService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async markOrUpdate(
    courseId: string,
    lessonId: string,
    userId: string,
    completed: boolean,
  ): Promise<LessonProgress> {
    // Proves course exists, lesson exists, and lesson belongs to courseId
    // (throws NotFoundException('Course not found') / 'Lesson not found').
    await this.lessonsService.findOne(courseId, lessonId);

    const enrollment = await this.enrollmentsService.findForUserAndCourse(
      userId,
      courseId,
    );
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      create: { userId, lessonId, completed },
      update: { completed },
    });
  }

  async findAllForCourse(
    courseId: string,
    userId: string,
  ): Promise<LessonProgress[]> {
    await this.coursesService.findOne(courseId);

    const enrollment = await this.enrollmentsService.findForUserAndCourse(
      userId,
      courseId,
    );
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    return this.prisma.lessonProgress.findMany({
      where: { userId, lesson: { courseId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
