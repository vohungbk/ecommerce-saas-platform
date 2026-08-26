import { Injectable } from '@nestjs/common';
import { LessonProgress, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LessonsService } from '../courses/lessons.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import {
  CourseCompletionService,
  CourseCompletionStatus,
} from './course-completion.service';

export interface CourseProgressSummary {
  courseId: string;
  totalLessons: number;
  completedLessons: number;
  remainingLessons: number;
  completionPercentage: number;
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lessonsService: LessonsService,
    private readonly enrollmentsService: EnrollmentsService,
    private readonly courseCompletionService: CourseCompletionService,
  ) {}

  async markOrUpdate(
    courseId: string,
    lessonId: string,
    user: User,
    completed: boolean,
  ): Promise<LessonProgress> {
    // Proves course exists, lesson exists, and lesson belongs to courseId
    // (throws NotFoundException('Course not found') / 'Lesson not found').
    await this.lessonsService.findOne(courseId, lessonId);

    // Proves the caller is enrolled in a PUBLISHED course (or is an ADMIN).
    await this.enrollmentsService.assertLearnerAccessToCourse(user, courseId);

    const progress = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: user.id, lessonId } },
      create: { userId: user.id, lessonId, completed },
      update: { completed },
    });

    if (completed) {
      await this.courseCompletionService.recordIfComplete(courseId, user.id);
    }

    return progress;
  }

  async findAllForCourse(
    courseId: string,
    user: User,
  ): Promise<LessonProgress[]> {
    await this.enrollmentsService.assertLearnerAccessToCourse(user, courseId);

    return this.prisma.lessonProgress.findMany({
      where: { userId: user.id, lesson: { courseId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async getSummary(
    courseId: string,
    user: User,
  ): Promise<CourseProgressSummary> {
    await this.enrollmentsService.assertLearnerAccessToCourse(user, courseId);

    const [totalLessons, completedLessons] = await this.prisma.$transaction([
      this.prisma.lesson.count({ where: { courseId } }),
      this.prisma.lessonProgress.count({
        where: { userId: user.id, completed: true, lesson: { courseId } },
      }),
    ]);

    const remainingLessons = totalLessons - completedLessons;
    const completionPercentage =
      totalLessons === 0
        ? 0
        : Math.round((completedLessons / totalLessons) * 100);

    return {
      courseId,
      totalLessons,
      completedLessons,
      remainingLessons,
      completionPercentage,
    };
  }

  getCompletionStatus(
    courseId: string,
    user: User,
  ): Promise<CourseCompletionStatus> {
    return this.courseCompletionService.getStatus(courseId, user);
  }
}
