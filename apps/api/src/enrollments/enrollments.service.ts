import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Course, Enrollment, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';

@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
  ) {}

  async enroll(courseId: string, userId: string): Promise<Enrollment> {
    const course = await this.coursesService.findOne(courseId);

    if (course.status !== 'PUBLISHED') {
      throw new ConflictException('Only a PUBLISHED course can be enrolled in');
    }

    const existing = await this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });

    if (existing) {
      throw new ConflictException('User is already enrolled in this course');
    }

    try {
      return await this.prisma.enrollment.create({
        data: { userId, courseId },
      });
    } catch (error) {
      // Race window between the pre-check above and this create: two
      // concurrent requests for the same (user, course) pair can both pass
      // the findUnique check before either write commits. The DB's
      // @@unique([userId, courseId]) constraint still catches it here as a
      // P2002 violation, which is normalized to the same 409 the pre-check
      // gives.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User is already enrolled in this course');
      }
      throw error;
    }
  }

  findForUserAndCourse(
    userId: string,
    courseId: string,
  ): Promise<Enrollment | null> {
    return this.prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
  }

  /**
   * Centralized "may this user access this course's learning content" check
   * (enrollment + published-status + admin bypass), used by every
   * learner-facing progress/completion code path instead of each duplicating
   * its own findOne + findForUserAndCourse + manual throw.
   *
   * Order matters: course exists -> enrolled -> published. A non-enrolled
   * caller always gets 404 regardless of publish state (no information leak
   * about a draft course's existence), while an already-enrolled caller
   * whose course was unpublished after the fact gets a distinguishable 403.
   * ADMIN callers bypass both the enrollment and published checks.
   */
  async assertLearnerAccessToCourse(
    user: User,
    courseId: string,
  ): Promise<Course> {
    const course = await this.coursesService.findOne(courseId);

    if (user.role === 'ADMIN') {
      return course;
    }

    const enrollment = await this.findForUserAndCourse(user.id, courseId);
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }

    if (course.status !== 'PUBLISHED') {
      throw new ForbiddenException('Course is not currently available');
    }

    return course;
  }

  findAllForUser(userId: string) {
    return this.prisma.enrollment.findMany({
      where: { userId },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
