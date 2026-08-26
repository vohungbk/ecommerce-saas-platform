import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { LessonsService } from '../courses/lessons.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CourseCompletionService } from './course-completion.service';
import { ProgressService } from './progress.service';

describe('ProgressService', () => {
  let prisma: {
    lessonProgress: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    lesson: {
      count: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let lessonsService: { findOne: jest.Mock };
  let enrollmentsService: { assertLearnerAccessToCourse: jest.Mock };
  let courseCompletionService: { recordIfComplete: jest.Mock };
  let service: ProgressService;

  const course = {
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'PUBLISHED',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const lesson = {
    id: 'lesson-1',
    courseId: 'course-1',
    title: 'Lesson 1',
    description: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const user: User = {
    id: 'user-1',
    email: 'learner@example.com',
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      lessonProgress: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(),
      },
      lesson: {
        count: jest.fn(),
      },
      $transaction: jest.fn(
        (ops: unknown[]) => Promise.all(ops) as Promise<unknown>,
      ),
    };
    lessonsService = { findOne: jest.fn().mockResolvedValue(lesson) };
    enrollmentsService = {
      assertLearnerAccessToCourse: jest.fn().mockResolvedValue(course),
    };
    courseCompletionService = {
      recordIfComplete: jest.fn().mockResolvedValue(undefined),
    };
    service = new ProgressService(
      prisma as unknown as PrismaService,
      lessonsService as unknown as LessonsService,
      enrollmentsService as unknown as EnrollmentsService,
      courseCompletionService as unknown as CourseCompletionService,
    );
  });

  describe('markOrUpdate', () => {
    it('resolves the lesson, checks access, then upserts the LessonProgress row', async () => {
      const persisted = {
        id: 'progress-1',
        userId: 'user-1',
        lessonId: 'lesson-1',
        completed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.lessonProgress.upsert.mockResolvedValue(persisted);

      const result = await service.markOrUpdate(
        'course-1',
        'lesson-1',
        user,
        true,
      );

      expect(lessonsService.findOne).toHaveBeenCalledWith(
        'course-1',
        'lesson-1',
      );
      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(user, 'course-1');
      expect(prisma.lessonProgress.upsert).toHaveBeenCalledWith({
        where: { userId_lessonId: { userId: 'user-1', lessonId: 'lesson-1' } },
        create: { userId: 'user-1', lessonId: 'lesson-1', completed: true },
        update: { completed: true },
      });
      expect(result).toEqual(persisted);
    });

    it('calls courseCompletionService.recordIfComplete when completed is true', async () => {
      prisma.lessonProgress.upsert.mockResolvedValue({
        id: 'progress-1',
        userId: 'user-1',
        lessonId: 'lesson-1',
        completed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.markOrUpdate('course-1', 'lesson-1', user, true);

      expect(courseCompletionService.recordIfComplete).toHaveBeenCalledWith(
        'course-1',
        'user-1',
      );
    });

    it('does not call courseCompletionService.recordIfComplete when completed is false', async () => {
      prisma.lessonProgress.upsert.mockResolvedValue({
        id: 'progress-1',
        userId: 'user-1',
        lessonId: 'lesson-1',
        completed: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.markOrUpdate('course-1', 'lesson-1', user, false);

      expect(courseCompletionService.recordIfComplete).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException from LessonsService.findOne and never checks access or upserts', async () => {
      lessonsService.findOne.mockRejectedValue(
        new NotFoundException('Lesson not found'),
      );

      await expect(
        service.markOrUpdate('course-1', 'missing-lesson', user, true),
      ).rejects.toThrow(NotFoundException);
      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
      expect(courseCompletionService.recordIfComplete).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException("Enrollment not found") from assertLearnerAccessToCourse, and never upserts', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Enrollment not found'),
      );

      await expect(
        service.markOrUpdate('course-1', 'lesson-1', user, true),
      ).rejects.toThrow(new NotFoundException('Enrollment not found'));
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
      expect(courseCompletionService.recordIfComplete).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException from assertLearnerAccessToCourse when the course is not published, and never upserts', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new ForbiddenException('Course is not currently available'),
      );

      await expect(
        service.markOrUpdate('course-1', 'lesson-1', user, true),
      ).rejects.toThrow(
        new ForbiddenException('Course is not currently available'),
      );
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
      expect(courseCompletionService.recordIfComplete).not.toHaveBeenCalled();
    });

    it('succeeds for an ADMIN caller even without enrollment (assertLearnerAccessToCourse bypass)', async () => {
      const admin: User = { ...user, id: 'admin-1', role: 'ADMIN' };
      const persisted = {
        id: 'progress-1',
        userId: 'admin-1',
        lessonId: 'lesson-1',
        completed: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.lessonProgress.upsert.mockResolvedValue(persisted);

      const result = await service.markOrUpdate(
        'course-1',
        'lesson-1',
        admin,
        true,
      );

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(admin, 'course-1');
      expect(result).toEqual(persisted);
    });
  });

  describe('findAllForCourse', () => {
    it('checks access, then queries progress scoped to userId and lesson.courseId', async () => {
      const rows = [
        {
          id: 'progress-1',
          userId: 'user-1',
          lessonId: 'lesson-1',
          completed: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      prisma.lessonProgress.findMany.mockResolvedValue(rows);

      const result = await service.findAllForCourse('course-1', user);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(user, 'course-1');
      expect(prisma.lessonProgress.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', lesson: { courseId: 'course-1' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(result).toEqual(rows);
    });

    it('propagates NotFoundException("Course not found") from assertLearnerAccessToCourse and never queries progress', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.findAllForCourse('missing-course', user),
      ).rejects.toThrow(new NotFoundException('Course not found'));
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException("Enrollment not found") from assertLearnerAccessToCourse, and never queries progress', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Enrollment not found'),
      );

      await expect(service.findAllForCourse('course-1', user)).rejects.toThrow(
        new NotFoundException('Enrollment not found'),
      );
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException from assertLearnerAccessToCourse when the course is not published', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new ForbiddenException('Course is not currently available'),
      );

      await expect(service.findAllForCourse('course-1', user)).rejects.toThrow(
        new ForbiddenException('Course is not currently available'),
      );
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array without error when the caller has no progress rows yet', async () => {
      prisma.lessonProgress.findMany.mockResolvedValue([]);

      const result = await service.findAllForCourse('course-1', user);

      expect(result).toEqual([]);
    });

    it('succeeds for an ADMIN caller on a course they are not enrolled in', async () => {
      const admin: User = { ...user, id: 'admin-1', role: 'ADMIN' };
      prisma.lessonProgress.findMany.mockResolvedValue([]);

      const result = await service.findAllForCourse('course-1', admin);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(admin, 'course-1');
      expect(result).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('propagates NotFoundException("Course not found") from assertLearnerAccessToCourse and never counts', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(service.getSummary('missing-course', user)).rejects.toThrow(
        new NotFoundException('Course not found'),
      );
      expect(prisma.lesson.count).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.count).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException("Enrollment not found") from assertLearnerAccessToCourse, and never counts', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Enrollment not found'),
      );

      await expect(service.getSummary('course-1', user)).rejects.toThrow(
        new NotFoundException('Enrollment not found'),
      );
      expect(prisma.lesson.count).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.count).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException from assertLearnerAccessToCourse when the course is not published', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new ForbiddenException('Course is not currently available'),
      );

      await expect(service.getSummary('course-1', user)).rejects.toThrow(
        new ForbiddenException('Course is not currently available'),
      );
      expect(prisma.lesson.count).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.count).not.toHaveBeenCalled();
    });

    it('returns totals/percentage for partial completion, scoped to the caller and the course', async () => {
      prisma.lesson.count.mockResolvedValue(4);
      prisma.lessonProgress.count.mockResolvedValue(2);

      const result = await service.getSummary('course-1', user);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(user, 'course-1');
      expect(prisma.lesson.count).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
      });
      expect(prisma.lessonProgress.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          completed: true,
          lesson: { courseId: 'course-1' },
        },
      });
      expect(result).toEqual({
        courseId: 'course-1',
        totalLessons: 4,
        completedLessons: 2,
        remainingLessons: 2,
        completionPercentage: 50,
      });
    });

    it('returns all-zero totals with completionPercentage 0 (no division by zero) for a zero-lesson course', async () => {
      prisma.lesson.count.mockResolvedValue(0);
      prisma.lessonProgress.count.mockResolvedValue(0);

      const result = await service.getSummary('course-1', user);

      expect(result).toEqual({
        courseId: 'course-1',
        totalLessons: 0,
        completedLessons: 0,
        remainingLessons: 0,
        completionPercentage: 0,
      });
    });

    it('returns completionPercentage 100 when every lesson is completed', async () => {
      prisma.lesson.count.mockResolvedValue(4);
      prisma.lessonProgress.count.mockResolvedValue(4);

      const result = await service.getSummary('course-1', user);

      expect(result).toEqual({
        courseId: 'course-1',
        totalLessons: 4,
        completedLessons: 4,
        remainingLessons: 0,
        completionPercentage: 100,
      });
    });

    it('succeeds for an ADMIN caller on a course they are not enrolled in', async () => {
      const admin: User = { ...user, id: 'admin-1', role: 'ADMIN' };
      prisma.lesson.count.mockResolvedValue(0);
      prisma.lessonProgress.count.mockResolvedValue(0);

      const result = await service.getSummary('course-1', admin);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(admin, 'course-1');
      expect(result.courseId).toBe('course-1');
    });
  });
});
