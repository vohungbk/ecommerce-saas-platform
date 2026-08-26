import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

export interface MyLearningItem {
  course: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };
  enrolledAt: Date;
  totalLessons: number;
  completedLessons: number;
  remainingLessons: number;
  completionPercentage: number;
  completed: boolean;
  completedAt: Date | null;
}

@Injectable()
export class MyLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async findForUser(userId: string): Promise<MyLearningItem[]> {
    const enrollments = await this.enrollmentsService.findAllForUser(userId);

    if (enrollments.length === 0) {
      return [];
    }

    const courseIds = enrollments.map((enrollment) => enrollment.courseId);

    const [lessons, completedProgress, completions] = await Promise.all([
      this.prisma.lesson.findMany({
        where: { courseId: { in: courseIds } },
        select: { id: true, courseId: true },
      }),
      this.prisma.lessonProgress.findMany({
        where: {
          userId,
          completed: true,
          lesson: { courseId: { in: courseIds } },
        },
        select: { lessonId: true },
      }),
      this.prisma.courseCompletion.findMany({
        where: { userId, courseId: { in: courseIds } },
      }),
    ]);

    const totalByCourseId = new Map<string, number>();
    const courseIdByLessonId = new Map<string, string>();
    for (const lesson of lessons) {
      totalByCourseId.set(
        lesson.courseId,
        (totalByCourseId.get(lesson.courseId) ?? 0) + 1,
      );
      courseIdByLessonId.set(lesson.id, lesson.courseId);
    }

    const completedByCourseId = new Map<string, number>();
    for (const progress of completedProgress) {
      const courseId = courseIdByLessonId.get(progress.lessonId);
      if (!courseId) {
        continue;
      }
      completedByCourseId.set(
        courseId,
        (completedByCourseId.get(courseId) ?? 0) + 1,
      );
    }

    const completionByCourseId = new Map(
      completions.map((completion) => [completion.courseId, completion]),
    );

    return enrollments.map((enrollment) => {
      const totalLessons = totalByCourseId.get(enrollment.courseId) ?? 0;
      const completedLessons =
        completedByCourseId.get(enrollment.courseId) ?? 0;
      const remainingLessons = totalLessons - completedLessons;
      const completionPercentage =
        totalLessons === 0
          ? 0
          : Math.round((completedLessons / totalLessons) * 100);
      const completion = completionByCourseId.get(enrollment.courseId);

      return {
        course: enrollment.course,
        enrolledAt: enrollment.createdAt,
        totalLessons,
        completedLessons,
        remainingLessons,
        completionPercentage,
        completed: completion !== undefined,
        completedAt: completion?.completedAt ?? null,
      };
    });
  }
}
