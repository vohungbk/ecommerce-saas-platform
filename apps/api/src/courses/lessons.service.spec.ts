import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LessonsService } from './lessons.service';
import { CoursesService } from './courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

describe('LessonsService', () => {
  let prisma: {
    lesson: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      aggregate: jest.Mock;
    };
    $transaction: jest.Mock;
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
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
      },
      // Supports both the interactive form (`$transaction(async (tx) => ...)`,
      // used by `create`) and the array form (`$transaction([...])`, used by
      // `reorder`) — `tx` is the same mock `prisma.lesson` object in the
      // interactive case, so assertions can target `prisma.lesson.*` either way.
      $transaction: jest.fn((arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return Promise.all(arg as unknown[]);
      }),
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
      expect(prisma.lesson.aggregate).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        _max: { position: true },
      });
      expect(prisma.lesson.create).toHaveBeenCalledWith({
        data: {
          courseId: 'course-1',
          title: 'Lesson 1',
          description: undefined,
          position: 1,
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
          position: 1,
        },
      });
    });

    it('assigns position 1 when the course has no lessons yet (_max.position is null)', async () => {
      prisma.lesson.aggregate.mockResolvedValue({ _max: { position: null } });
      const dto = { title: 'Lesson 1' } as CreateLessonDto;

      await service.create('course-1', dto);

      expect(prisma.lesson.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ position: 1 }) as unknown,
        }),
      );
    });

    it('assigns position as max + 1 when the course already has lessons', async () => {
      prisma.lesson.aggregate.mockResolvedValue({ _max: { position: 4 } });
      const dto = { title: 'Lesson 5' } as CreateLessonDto;

      await service.create('course-1', dto);

      expect(prisma.lesson.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ position: 5 }) as unknown,
        }),
      );
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
    it('resolves the course first, then queries lessons for that course ordered by position/createdAt/id ascending', async () => {
      const lessons = [{ id: 'lesson-1' }, { id: 'lesson-2' }];
      prisma.lesson.findMany.mockResolvedValue(lessons);

      const result = await service.findAllForCourse('course-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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

  describe('update', () => {
    const existingLesson = {
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Original title',
      description: 'Original description',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      prisma.lesson.findFirst.mockResolvedValue(existingLesson);
      prisma.lesson.update.mockResolvedValue(existingLesson);
    });

    it('resolves via findOne (course lookup then findFirst by id/courseId) before calling prisma.lesson.update', async () => {
      const dto = { title: 'New title' } as UpdateLessonDto;

      await service.update('course-1', 'lesson-1', dto);

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith({
        where: { id: 'lesson-1', courseId: 'course-1' },
      });
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: { title: 'New title' },
      });
    });

    it('updates only title when only title is provided', async () => {
      const dto = { title: '  New Title  ' } as UpdateLessonDto;

      await service.update('course-1', 'lesson-1', dto);

      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: { title: 'New Title' },
      });
    });

    it('updates only description when only description is provided', async () => {
      const dto = { description: '  New description  ' } as UpdateLessonDto;

      await service.update('course-1', 'lesson-1', dto);

      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: { description: 'New description' },
      });
    });

    it('updates both title and description, both trimmed, when both are provided', async () => {
      const dto = {
        title: '  New Title  ',
        description: '  New description  ',
      } as UpdateLessonDto;

      await service.update('course-1', 'lesson-1', dto);

      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: { title: 'New Title', description: 'New description' },
      });
    });

    it('treats an explicit null title as "not provided" without crashing', async () => {
      const dto = { title: null } as unknown as UpdateLessonDto;

      await expect(
        service.update('course-1', 'lesson-1', dto),
      ).resolves.toEqual(existingLesson);
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: {},
      });
    });

    it('treats an explicit null description as "not provided" without crashing', async () => {
      const dto = { description: null } as unknown as UpdateLessonDto;

      await expect(
        service.update('course-1', 'lesson-1', dto),
      ).resolves.toEqual(existingLesson);
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
        data: {},
      });
    });

    it('throws NotFoundException and never calls prisma.lesson.update when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );
      const dto = { title: 'New title' } as UpdateLessonDto;

      await expect(
        service.update('missing-course', 'lesson-1', dto),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and never calls prisma.lesson.update when the lesson does not exist under that course, or belongs to a different course', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);
      const dto = { title: 'New title' } as UpdateLessonDto;

      await expect(
        service.update('course-1', 'lesson-from-other-course', dto),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const existingLesson = {
      id: 'lesson-1',
      courseId: 'course-1',
      title: 'Original title',
      description: 'Original description',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      prisma.lesson.findFirst.mockResolvedValue(existingLesson);
      prisma.lesson.delete.mockResolvedValue(existingLesson);
    });

    it('resolves via findOne (course lookup then findFirst by id/courseId) before calling prisma.lesson.delete', async () => {
      const result = await service.remove('course-1', 'lesson-1');

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.lesson.findFirst).toHaveBeenCalledWith({
        where: { id: 'lesson-1', courseId: 'course-1' },
      });
      expect(prisma.lesson.delete).toHaveBeenCalledWith({
        where: { id: 'lesson-1' },
      });
      expect(result).toEqual(existingLesson);
    });

    it('throws NotFoundException and never calls prisma.lesson.delete when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.remove('missing-course', 'lesson-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and never calls prisma.lesson.delete when the lesson does not exist under that course, or belongs to a different course', async () => {
      prisma.lesson.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('course-1', 'lesson-from-other-course'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.lesson.delete).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    const lessonA = { id: 'lesson-a', position: 1 };
    const lessonB = { id: 'lesson-b', position: 2 };
    const lessonC = { id: 'lesson-c', position: 3 };

    beforeEach(() => {
      prisma.lesson.findMany.mockResolvedValue([
        { id: lessonA.id },
        { id: lessonB.id },
        { id: lessonC.id },
      ]);
    });

    it('resolves the course first, before validating or persisting anything', async () => {
      const dto = {
        lessons: [
          { id: lessonA.id, position: 3 },
          { id: lessonB.id, position: 1 },
          { id: lessonC.id, position: 2 },
        ],
      };

      await service.reorder('course-1', dto);

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
    });

    it('persists a single lesson move via prisma.lesson.update inside a transaction, then returns the course lessons in their new order', async () => {
      const dto = {
        lessons: [{ id: lessonA.id, position: 2 }],
      };
      prisma.lesson.findMany.mockResolvedValueOnce([{ id: lessonA.id }]);
      const reordered = [{ id: lessonA.id, position: 2 }];
      prisma.lesson.findMany.mockResolvedValueOnce(reordered);

      const result = await service.reorder('course-1', dto);

      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: lessonA.id },
        data: { position: 2 },
      });
      expect(result).toEqual(reordered);
    });

    it('persists every lesson move in the payload when reordering multiple lessons at once', async () => {
      const dto = {
        lessons: [
          { id: lessonA.id, position: 3 },
          { id: lessonB.id, position: 1 },
          { id: lessonC.id, position: 2 },
        ],
      };

      await service.reorder('course-1', dto);

      expect(prisma.lesson.update).toHaveBeenCalledTimes(3);
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: lessonA.id },
        data: { position: 3 },
      });
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: lessonB.id },
        data: { position: 1 },
      });
      expect(prisma.lesson.update).toHaveBeenCalledWith({
        where: { id: lessonC.id },
        data: { position: 2 },
      });
    });

    it('throws BadRequestException and never calls prisma.lesson.update when the payload has a duplicate lesson id', async () => {
      const dto = {
        lessons: [
          { id: lessonA.id, position: 1 },
          { id: lessonA.id, position: 2 },
        ],
      };

      await expect(service.reorder('course-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException and never calls prisma.lesson.update when the payload has a duplicate position', async () => {
      const dto = {
        lessons: [
          { id: lessonA.id, position: 1 },
          { id: lessonB.id, position: 1 },
        ],
      };

      await expect(service.reorder('course-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and never calls prisma.lesson.update when a payload id does not belong to this course', async () => {
      prisma.lesson.findMany.mockResolvedValue([{ id: lessonA.id }]);
      const dto = {
        lessons: [{ id: 'lesson-from-other-course', position: 1 }],
      };

      await expect(service.reorder('course-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it("throws BadRequestException and never calls prisma.lesson.update when the payload omits some of the course's lessons", async () => {
      const dto = {
        lessons: [{ id: lessonA.id, position: 1 }],
      };

      await expect(service.reorder('course-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and never calls prisma.lesson.findMany when the course does not exist', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );
      const dto = {
        lessons: [{ id: lessonA.id, position: 1 }],
      };

      await expect(service.reorder('missing-course', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(prisma.lesson.update).not.toHaveBeenCalled();
    });
  });
});
