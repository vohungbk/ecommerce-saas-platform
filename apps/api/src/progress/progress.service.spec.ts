import { NotFoundException } from '@nestjs/common';
import { CoursesService } from '../courses/courses.service';
import { LessonsService } from '../courses/lessons.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from './progress.service';

describe('ProgressService', () => {
  let prisma: {
    lessonProgress: {
      upsert: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let coursesService: { findOne: jest.Mock };
  let lessonsService: { findOne: jest.Mock };
  let enrollmentsService: { findForUserAndCourse: jest.Mock };
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

  const enrollment = {
    id: 'enrollment-1',
    userId: 'user-1',
    courseId: 'course-1',
    createdAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      lessonProgress: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    coursesService = { findOne: jest.fn().mockResolvedValue(course) };
    lessonsService = { findOne: jest.fn().mockResolvedValue(lesson) };
    enrollmentsService = {
      findForUserAndCourse: jest.fn().mockResolvedValue(enrollment),
    };
    service = new ProgressService(
      prisma as unknown as PrismaService,
      coursesService as unknown as CoursesService,
      lessonsService as unknown as LessonsService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  describe('markOrUpdate', () => {
    it('resolves the lesson, checks enrollment, then upserts the LessonProgress row', async () => {
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
        'user-1',
        true,
      );

      expect(lessonsService.findOne).toHaveBeenCalledWith(
        'course-1',
        'lesson-1',
      );
      expect(enrollmentsService.findForUserAndCourse).toHaveBeenCalledWith(
        'user-1',
        'course-1',
      );
      expect(prisma.lessonProgress.upsert).toHaveBeenCalledWith({
        where: { userId_lessonId: { userId: 'user-1', lessonId: 'lesson-1' } },
        create: { userId: 'user-1', lessonId: 'lesson-1', completed: true },
        update: { completed: true },
      });
      expect(result).toEqual(persisted);
    });

    it('propagates NotFoundException from LessonsService.findOne and never checks enrollment or upserts', async () => {
      lessonsService.findOne.mockRejectedValue(
        new NotFoundException('Lesson not found'),
      );

      await expect(
        service.markOrUpdate('course-1', 'missing-lesson', 'user-1', true),
      ).rejects.toThrow(NotFoundException);
      expect(enrollmentsService.findForUserAndCourse).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Enrollment not found") when the caller is not enrolled, and never upserts', async () => {
      enrollmentsService.findForUserAndCourse.mockResolvedValue(null);

      await expect(
        service.markOrUpdate('course-1', 'lesson-1', 'user-1', true),
      ).rejects.toThrow(new NotFoundException('Enrollment not found'));
      expect(prisma.lessonProgress.upsert).not.toHaveBeenCalled();
    });
  });

  describe('findAllForCourse', () => {
    it('resolves the course, checks enrollment, then queries progress scoped to userId and lesson.courseId', async () => {
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

      const result = await service.findAllForCourse('course-1', 'user-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(enrollmentsService.findForUserAndCourse).toHaveBeenCalledWith(
        'user-1',
        'course-1',
      );
      expect(prisma.lessonProgress.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', lesson: { courseId: 'course-1' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(result).toEqual(rows);
    });

    it('propagates NotFoundException from CoursesService.findOne and never checks enrollment or queries progress', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.findAllForCourse('missing-course', 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(enrollmentsService.findForUserAndCourse).not.toHaveBeenCalled();
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Enrollment not found") when the caller is not enrolled, and never queries progress', async () => {
      enrollmentsService.findForUserAndCourse.mockResolvedValue(null);

      await expect(
        service.findAllForCourse('course-1', 'user-1'),
      ).rejects.toThrow(new NotFoundException('Enrollment not found'));
      expect(prisma.lessonProgress.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array without error when the caller has no progress rows yet', async () => {
      prisma.lessonProgress.findMany.mockResolvedValue([]);

      const result = await service.findAllForCourse('course-1', 'user-1');

      expect(result).toEqual([]);
    });
  });
});
