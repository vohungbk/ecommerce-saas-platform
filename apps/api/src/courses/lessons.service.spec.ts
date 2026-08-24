import { NotFoundException } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { CoursesService } from './courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';

describe('LessonsService', () => {
  let prisma: {
    lesson: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
  };
  let coursesService: { findOne: jest.Mock };
  let service: LessonsService;

  const existingCourse = {
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'DRAFT',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    prisma = {
      lesson: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
    };
    coursesService = {
      findOne: jest.fn().mockResolvedValue(existingCourse),
    };
    service = new LessonsService(
      prisma as unknown as PrismaService,
      coursesService as unknown as CoursesService,
    );
  });

  describe('create', () => {
    it('resolves the course before creating the lesson, and passes courseId through to the create data', async () => {
      const dto = { title: 'Lesson 1' } as CreateLessonDto;

      await service.create('course-1', dto);

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.create).toHaveBeenCalledWith({
        data: {
          courseId: 'course-1',
          title: 'Lesson 1',
          description: undefined,
        },
      });
    });

    it('trims title and description before persisting', async () => {
      const dto = {
        title: '  Lesson 1  ',
        description: '  A first lesson  ',
      } as CreateLessonDto;

      await service.create('course-1', dto);

      expect(prisma.lesson.create).toHaveBeenCalledWith({
        data: {
          courseId: 'course-1',
          title: 'Lesson 1',
          description: 'A first lesson',
        },
      });
    });

    it('throws NotFoundException and never calls prisma.lesson.create when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );
      const dto = { title: 'Lesson 1' } as CreateLessonDto;

      await expect(service.create('missing-course', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.lesson.create).not.toHaveBeenCalled();
    });
  });

  describe('findAllForCourse', () => {
    it('resolves the course first, then queries lessons for that course ordered by createdAt/id ascending', async () => {
      const lessons = [{ id: 'lesson-1' }, { id: 'lesson-2' }];
      prisma.lesson.findMany.mockResolvedValue(lessons);

      const result = await service.findAllForCourse('course-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      expect(result).toEqual(lessons);
    });

    it('returns an empty array without error when there are no lessons', async () => {
      prisma.lesson.findMany.mockResolvedValue([]);

      const result = await service.findAllForCourse('course-1');

      expect(result).toEqual([]);
    });

    it('throws NotFoundException and never calls prisma.lesson.findMany when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(service.findAllForCourse('missing-course')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('resolves the course first, then returns the lesson matching both id and courseId', async () => {
      const lesson = {
        id: 'lesson-1',
        courseId: 'course-1',
        title: 'Lesson 1',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.lesson.findFirst.mockResolvedValue(lesson);

      const result = await service.findOne('course-1', 'lesson-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith({
        where: { id: 'lesson-1', courseId: 'course-1' },
      });
      expect(result).toEqual(lesson);
    });

    it('throws NotFoundException ("Lesson not found") when prisma resolves no row for the given id/courseId pair', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('course-1', 'missing-lesson'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the lessonId exists but belongs to a different course (proves where includes courseId, not just id)', async () => {
      // The lesson row exists in the DB, but under a different courseId, so
      // a `where: { id, courseId }` query correctly resolves no row here.
      // This mock only makes sense if the service queries by both fields —
      // a `findUnique({ id })`-only implementation would instead resolve
      // the row and incorrectly return it (leaking a lesson across courses).
      prisma.lesson.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne('course-1', 'lesson-from-other-course'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith({
        where: { id: 'lesson-from-other-course', courseId: 'course-1' },
      });
    });

    it('throws NotFoundException and never calls prisma.lesson.findFirst when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.findOne('missing-course', 'lesson-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.findFirst).not.toHaveBeenCalled();
    });
  });
});
