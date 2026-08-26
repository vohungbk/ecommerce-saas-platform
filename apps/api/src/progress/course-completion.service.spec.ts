import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseCompletionService } from './course-completion.service';

describe('CourseCompletionService', () => {
  let prisma: {
    courseCompletion: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    lesson: {
      count: jest.Mock;
    };
    lessonProgress: {
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let coursesService: { findOne: jest.Mock };
  let enrollmentsService: { findForUserAndCourse: jest.Mock };
  let service: CourseCompletionService;

  const course = {
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'PUBLISHED',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const enrollment = {
    id: 'enrollment-1',
    userId: 'user-1',
    courseId: 'course-1',
    createdAt: new Date(),
  };

  const knownRequestError = (code: string) => {
    const error = Object.create(
      Prisma.PrismaClientKnownRequestError.prototype,
    ) as Prisma.PrismaClientKnownRequestError;
    Object.assign(error, { code, message: 'Unique constraint failed' });
    return error;
  };

  beforeEach(() => {
    prisma = {
      courseCompletion: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      lesson: {
        count: jest.fn(),
      },
      lessonProgress: {
        count: jest.fn(),
      },
      $transaction: jest.fn(
        (ops: unknown[]) => Promise.all(ops) as Promise<unknown>,
      ),
    };
    coursesService = { findOne: jest.fn().mockResolvedValue(course) };
    enrollmentsService = {
      findForUserAndCourse: jest.fn().mockResolvedValue(enrollment),
    };
    service = new CourseCompletionService(
      prisma as unknown as PrismaService,
      coursesService as unknown as CoursesService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  describe('recordIfComplete', () => {
    it('is a no-op when a CourseCompletion row already exists (Decision C: never re-checks)', async () => {
      prisma.courseCompletion.findUnique.mockResolvedValue({
        id: 'completion-1',
        userId: 'user-1',
        courseId: 'course-1',
        completedAt: new Date(),
      });

      await service.recordIfComplete('course-1', 'user-1');

      expect(prisma.lesson.count).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.count).not.toHaveBeenCalled();
      expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    });

    it('does not create a row for a zero-lesson course (Decision B)', async () => {
      prisma.lesson.count.mockResolvedValue(0);
      prisma.lessonProgress.count.mockResolvedValue(0);

      await service.recordIfComplete('course-1', 'user-1');

      expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    });

    it('does not create a row when completion is partial', async () => {
      prisma.lesson.count.mockResolvedValue(4);
      prisma.lessonProgress.count.mockResolvedValue(2);

      await service.recordIfComplete('course-1', 'user-1');

      expect(prisma.courseCompletion.create).not.toHaveBeenCalled();
    });

    it('creates a CourseCompletion row when every lesson is completed', async () => {
      prisma.lesson.count.mockResolvedValue(3);
      prisma.lessonProgress.count.mockResolvedValue(3);
      prisma.courseCompletion.create.mockResolvedValue({
        id: 'completion-1',
        userId: 'user-1',
        courseId: 'course-1',
        completedAt: new Date(),
      });

      await service.recordIfComplete('course-1', 'user-1');

      expect(prisma.courseCompletion.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', courseId: 'course-1' },
      });
    });

    it('swallows a P2002 race error from a concurrent create and does not rethrow', async () => {
      prisma.lesson.count.mockResolvedValue(2);
      prisma.lessonProgress.count.mockResolvedValue(2);
      prisma.courseCompletion.create.mockRejectedValue(
        knownRequestError('P2002'),
      );

      await expect(
        service.recordIfComplete('course-1', 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('rethrows any error other than P2002', async () => {
      prisma.lesson.count.mockResolvedValue(2);
      prisma.lessonProgress.count.mockResolvedValue(2);
      prisma.courseCompletion.create.mockRejectedValue(
        knownRequestError('P2025'),
      );

      await expect(
        service.recordIfComplete('course-1', 'user-1'),
      ).rejects.toMatchObject({ code: 'P2025' });
    });

    it('rethrows a non-Prisma error unchanged', async () => {
      prisma.lesson.count.mockResolvedValue(1);
      prisma.lessonProgress.count.mockResolvedValue(1);
      const genericError = new Error('connection lost');
      prisma.courseCompletion.create.mockRejectedValue(genericError);

      await expect(
        service.recordIfComplete('course-1', 'user-1'),
      ).rejects.toThrow(genericError);
    });
  });

  describe('getStatus', () => {
    it('propagates NotFoundException from CoursesService.findOne and never checks enrollment or completion', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.getStatus('missing-course', 'user-1'),
      ).rejects.toThrow(new NotFoundException('Course not found'));
      expect(enrollmentsService.findForUserAndCourse).not.toHaveBeenCalled();
      expect(prisma.courseCompletion.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Enrollment not found") when the caller is not enrolled', async () => {
      enrollmentsService.findForUserAndCourse.mockResolvedValue(null);

      await expect(service.getStatus('course-1', 'user-1')).rejects.toThrow(
        new NotFoundException('Enrollment not found'),
      );
      expect(prisma.courseCompletion.findUnique).not.toHaveBeenCalled();
    });

    it('returns completed: false, completedAt: null when no CourseCompletion row exists', async () => {
      prisma.courseCompletion.findUnique.mockResolvedValue(null);

      const result = await service.getStatus('course-1', 'user-1');

      expect(result).toEqual({
        courseId: 'course-1',
        completed: false,
        completedAt: null,
      });
    });

    it('returns completed: true with the persisted completedAt when a CourseCompletion row exists', async () => {
      const completedAt = new Date('2026-08-25T12:00:00.000Z');
      prisma.courseCompletion.findUnique.mockResolvedValue({
        id: 'completion-1',
        userId: 'user-1',
        courseId: 'course-1',
        completedAt,
      });

      const result = await service.getStatus('course-1', 'user-1');

      expect(result).toEqual({
        courseId: 'course-1',
        completed: true,
        completedAt,
      });
    });
  });
});
