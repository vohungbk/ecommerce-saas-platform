import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
});
