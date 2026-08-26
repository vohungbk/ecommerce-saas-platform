import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

export interface CourseCompletionStatus {
  courseId: string;
  completed: boolean;
  completedAt: Date | null;
}

@Injectable()
export class CourseCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  async recordIfComplete(courseId: string, userId: string): Promise<void> {
    const existing = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) {
      return;
    }

    const [totalLessons, completedLessons] = await this.prisma.$transaction([
      this.prisma.lesson.count({ where: { courseId } }),
      this.prisma.lessonProgress.count({
        where: { userId, completed: true, lesson: { courseId } },
      }),
    ]);

    if (totalLessons === 0) {
      return;
    }
    if (completedLessons < totalLessons) {
      return;
    }

    try {
      await this.prisma.courseCompletion.create({
        data: { userId, courseId },
      });
    } catch (error) {
      // Race window between the findUnique check above and this create: two
      // concurrent requests completing the final lesson at the same time can
      // both pass the pre-check before either write commits. The DB's
      // @@unique([userId, courseId]) constraint still catches it here as a
      // P2002 violation, which is swallowed since a concurrent request
      // already created the row — this call is a no-op either way, mirroring
      // EnrollmentsService.enroll's race-window handling.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  async getStatus(
    courseId: string,
    userId: string,
  ): Promise<CourseCompletionStatus> {
    await this.coursesService.findOne(courseId);

    const enrollment = await this.enrollmentsService.findForUserAndCourse(
      userId,
      courseId,
    );
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    const record = await this.prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    return {
      courseId,
      completed: record !== null,
      completedAt: record?.completedAt ?? null,
    };
  }
}
