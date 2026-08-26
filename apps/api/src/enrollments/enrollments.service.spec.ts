import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { EnrollmentsService } from './enrollments.service';
import { CoursesService } from '../courses/courses.service';
import { PrismaService } from '../prisma/prisma.service';

describe('EnrollmentsService', () => {
  let prisma: {
    enrollment: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let coursesService: { findOne: jest.Mock };
  let service: EnrollmentsService;

  const publishedCourse = {
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'PUBLISHED',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = {
      enrollment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    coursesService = {
      findOne: jest.fn().mockResolvedValue(publishedCourse),
    };
    service = new EnrollmentsService(
      prisma as unknown as PrismaService,
      coursesService as unknown as CoursesService,
    );
  });

  describe('enroll', () => {
    it('resolves the course, pre-checks for a duplicate, then creates the enrollment', async () => {
      const created = {
        id: 'enrollment-1',
        userId: 'user-1',
        courseId: 'course-1',
        createdAt: new Date(),
      };
      prisma.enrollment.create.mockResolvedValue(created);

      const result = await service.enroll('course-1', 'user-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { userId_courseId: { userId: 'user-1', courseId: 'course-1' } },
      });
      expect(prisma.enrollment.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', courseId: 'course-1' },
      });
      expect(result).toEqual(created);
    });

    it('propagates NotFoundException from CoursesService.findOne and never checks/creates an enrollment', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(service.enroll('missing-course', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the course is not PUBLISHED (e.g. DRAFT) and never creates an enrollment', async () => {
      coursesService.findOne.mockResolvedValue({
        ...publishedCourse,
        status: 'DRAFT',
      });

      await expect(service.enroll('course-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException via the pre-check when an enrollment already exists, and never calls create', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        userId: 'user-1',
        courseId: 'course-1',
        createdAt: new Date(),
      });

      await expect(service.enroll('course-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when create() fails with a P2002 unique constraint violation (race condition fallback)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.9.1' },
      );
      prisma.enrollment.create.mockRejectedValue(p2002);

      await expect(service.enroll('course-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows an unrelated error from create() unchanged', async () => {
      const otherError = new Error('unexpected db error');
      prisma.enrollment.create.mockRejectedValue(otherError);

      await expect(service.enroll('course-1', 'user-1')).rejects.toBe(
        otherError,
      );
    });
  });

  describe('findForUserAndCourse', () => {
    it('queries the enrollment by the composite userId_courseId unique key', async () => {
      const enrollment = {
        id: 'enrollment-1',
        userId: 'user-1',
        courseId: 'course-1',
        createdAt: new Date(),
      };
      prisma.enrollment.findUnique.mockResolvedValue(enrollment);

      const result = await service.findForUserAndCourse('user-1', 'course-1');

      expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { userId_courseId: { userId: 'user-1', courseId: 'course-1' } },
      });
      expect(result).toEqual(enrollment);
    });

    it('returns null when no enrollment exists for the (userId, courseId) pair', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(null);

      const result = await service.findForUserAndCourse('user-1', 'course-1');

      expect(result).toBeNull();
    });
  });

  describe('findAllForUser', () => {
    it('queries enrollments scoped strictly to the given userId, including the nested course', async () => {
      const enrollments = [
        {
          id: 'enrollment-1',
          userId: 'user-1',
          courseId: 'course-1',
          createdAt: new Date(),
          course: publishedCourse,
        },
      ];
      prisma.enrollment.findMany.mockResolvedValue(enrollments);

      const result = await service.findAllForUser('user-1');

      expect(prisma.enrollment.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
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
      expect(result).toEqual(enrollments);
    });

    it('returns an empty array without error when the user has no enrollments', async () => {
      prisma.enrollment.findMany.mockResolvedValue([]);

      const result = await service.findAllForUser('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('assertLearnerAccessToCourse', () => {
    const learner: User = {
      id: 'user-1',
      email: 'learner@example.com',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const admin: User = {
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('returns the course for an enrolled learner and a PUBLISHED course', async () => {
      prisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        userId: 'user-1',
        courseId: 'course-1',
        createdAt: new Date(),
      });

      const result = await service.assertLearnerAccessToCourse(
        learner,
        'course-1',
      );

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { userId_courseId: { userId: 'user-1', courseId: 'course-1' } },
      });
      expect(result).toEqual(publishedCourse);
    });

    it('propagates NotFoundException from CoursesService.findOne and never checks enrollment', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.assertLearnerAccessToCourse(learner, 'missing-course'),
      ).rejects.toThrow(new NotFoundException('Course not found'));
      expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Enrollment not found") when the learner is not enrolled', async () => {
      prisma.enrollment.findUnique.mockResolvedValue(null);

      await expect(
        service.assertLearnerAccessToCourse(learner, 'course-1'),
      ).rejects.toThrow(new NotFoundException('Enrollment not found'));
    });

    it('throws ForbiddenException when the learner is enrolled but the course is not PUBLISHED', async () => {
      coursesService.findOne.mockResolvedValue({
        ...publishedCourse,
        status: 'DRAFT',
      });
      prisma.enrollment.findUnique.mockResolvedValue({
        id: 'enrollment-1',
        userId: 'user-1',
        courseId: 'course-1',
        createdAt: new Date(),
      });

      await expect(
        service.assertLearnerAccessToCourse(learner, 'course-1'),
      ).rejects.toThrow(
        new ForbiddenException('Course is not currently available'),
      );
    });

    it('bypasses both the enrollment and published checks for an ADMIN caller', async () => {
      coursesService.findOne.mockResolvedValue({
        ...publishedCourse,
        status: 'DRAFT',
      });
      prisma.enrollment.findUnique.mockResolvedValue(null);

      const result = await service.assertLearnerAccessToCourse(
        admin,
        'course-1',
      );

      expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual({ ...publishedCourse, status: 'DRAFT' });
    });
  });
});
