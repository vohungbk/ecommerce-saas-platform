import { ConflictException, Injectable } from '@nestjs/common';
import { Enrollment, Prisma } from '@prisma/client';
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
