import { MyLearningService } from './my-learning.service';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';

describe('MyLearningService', () => {
  let prisma: {
    lesson: { findMany: jest.Mock };
    lessonProgress: { findMany: jest.Mock };
    courseCompletion: { findMany: jest.Mock };
  };
  let enrollmentsService: { findAllForUser: jest.Mock };
  let service: MyLearningService;

  const course = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'PUBLISHED',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  });

  const enrollment = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'enrollment-1',
    userId: 'user-1',
    courseId: 'course-1',
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    course: course(),
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      lesson: { findMany: jest.fn().mockResolvedValue([]) },
      lessonProgress: { findMany: jest.fn().mockResolvedValue([]) },
      courseCompletion: { findMany: jest.fn().mockResolvedValue([]) },
    };
    enrollmentsService = {
      findAllForUser: jest.fn().mockResolvedValue([]),
    };
    service = new MyLearningService(
      prisma as unknown as PrismaService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  describe('findForUser', () => {
    it('returns an empty array and issues no further queries when the user has no enrollments', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([]);

      const result = await service.findForUser('user-1');

      expect(result).toEqual([]);
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
      expect(prisma.courseCompletion.findMany).not.toHaveBeenCalled();
    });

    it('scopes the batched queries to the enrolled course ids and to the given userId', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
      ]);

      await service.findForUser('user-1');

      expect(prisma.lesson.findMany).toHaveBeenCalledWith({
        where: { courseId: { in: ['course-1'] } },
        select: { id: true, courseId: true },
      });
      expect(prisma.lessonProgress.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          completed: true,
          lesson: { courseId: { in: ['course-1'] } },
        },
        select: { lessonId: true },
      });
      expect(prisma.courseCompletion.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', courseId: { in: ['course-1'] } },
      });
    });

    it('returns a single item with 0% completion when no lessons are completed', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
        { id: 'lesson-2', courseId: 'course-1' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([]);
      prisma.courseCompletion.findMany.mockResolvedValue([]);

      const result = await service.findForUser('user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        course: course(),
        totalLessons: 2,
        completedLessons: 0,
        remainingLessons: 2,
        completionPercentage: 0,
        completed: false,
        completedAt: null,
      });
    });

    it('computes a partial completion percentage strictly between 0 and 100', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
        { id: 'lesson-2', courseId: 'course-1' },
        { id: 'lesson-3', courseId: 'course-1' },
        { id: 'lesson-4', courseId: 'course-1' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([
        { lessonId: 'lesson-1' },
      ]);
      prisma.courseCompletion.findMany.mockResolvedValue([]);

      const result = await service.findForUser('user-1');

      expect(result[0]).toMatchObject({
        totalLessons: 4,
        completedLessons: 1,
        remainingLessons: 3,
        completionPercentage: 25,
        completed: false,
        completedAt: null,
      });
    });

    it('returns completed: true and the persisted completedAt when a CourseCompletion row exists (100%)', async () => {
      const completedAt = new Date('2026-02-01T00:00:00.000Z');
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([
        { lessonId: 'lesson-1' },
      ]);
      prisma.courseCompletion.findMany.mockResolvedValue([
        { userId: 'user-1', courseId: 'course-1', completedAt },
      ]);

      const result = await service.findForUser('user-1');

      expect(result[0]).toMatchObject({
        totalLessons: 1,
        completedLessons: 1,
        remainingLessons: 0,
        completionPercentage: 100,
        completed: true,
        completedAt,
      });
    });

    it('reads completed/completedAt from the persisted CourseCompletion row rather than recomputing from completed === total (sticky completion)', async () => {
      // Simulates the "un-complete after full completion" case: completion
      // row persists even though completedLessons no longer equals total.
      const completedAt = new Date('2026-02-01T00:00:00.000Z');
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
        { id: 'lesson-2', courseId: 'course-1' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([]);
      prisma.courseCompletion.findMany.mockResolvedValue([
        { userId: 'user-1', courseId: 'course-1', completedAt },
      ]);

      const result = await service.findForUser('user-1');

      expect(result[0]).toMatchObject({
        totalLessons: 2,
        completedLessons: 0,
        completionPercentage: 0,
        completed: true,
        completedAt,
      });
    });

    it('returns totalLessons: 0 and completionPercentage: 0 (not NaN) for a zero-lesson course', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([]);
      prisma.lessonProgress.findMany.mockResolvedValue([]);
      prisma.courseCompletion.findMany.mockResolvedValue([]);

      const result = await service.findForUser('user-1');

      expect(result[0].totalLessons).toBe(0);
      expect(result[0].completedLessons).toBe(0);
      expect(result[0].remainingLessons).toBe(0);
      expect(result[0].completionPercentage).toBe(0);
      expect(Number.isNaN(result[0].completionPercentage)).toBe(false);
      expect(result[0].completed).toBe(false);
      expect(result[0].completedAt).toBeNull();
    });

    it('returns one item per enrolled course, preserving the enrollment order and each course scoped correctly', async () => {
      const enrollmentA = enrollment({
        id: 'enrollment-1',
        courseId: 'course-1',
        course: course({ id: 'course-1', title: 'Course A' }),
      });
      const enrollmentB = enrollment({
        id: 'enrollment-2',
        courseId: 'course-2',
        course: course({ id: 'course-2', title: 'Course B' }),
      });
      enrollmentsService.findAllForUser.mockResolvedValue([
        enrollmentA,
        enrollmentB,
      ]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
        { id: 'lesson-2', courseId: 'course-2' },
        { id: 'lesson-3', courseId: 'course-2' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([
        { lessonId: 'lesson-2' },
        { lessonId: 'lesson-3' },
      ]);
      prisma.courseCompletion.findMany.mockResolvedValue([
        { userId: 'user-1', courseId: 'course-2', completedAt: new Date() },
      ]);

      const result = await service.findForUser('user-1');

      expect(result).toHaveLength(2);
      expect(result[0].course.id).toBe('course-1');
      expect(result[0]).toMatchObject({
        totalLessons: 1,
        completedLessons: 0,
        completionPercentage: 0,
        completed: false,
      });
      expect(result[1].course.id).toBe('course-2');
      expect(result[1]).toMatchObject({
        totalLessons: 2,
        completedLessons: 2,
        completionPercentage: 100,
        completed: true,
      });
    });

    it('ignores a completed lesson-progress row whose lessonId no longer maps to any known lesson', async () => {
      enrollmentsService.findAllForUser.mockResolvedValue([enrollment()]);
      prisma.lesson.findMany.mockResolvedValue([
        { id: 'lesson-1', courseId: 'course-1' },
      ]);
      prisma.lessonProgress.findMany.mockResolvedValue([
        { lessonId: 'lesson-1' },
        { lessonId: 'orphan-lesson-id' },
      ]);
      prisma.courseCompletion.findMany.mockResolvedValue([]);

      const result = await service.findForUser('user-1');

      expect(result[0].completedLessons).toBe(1);
      expect(result[0].completionPercentage).toBe(100);
    });
  });
});
