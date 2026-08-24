import { ConflictException, NotFoundException } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

describe('CoursesService', () => {
  let prisma: {
    course: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: CoursesService;

  beforeEach(() => {
    prisma = {
      course: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(
        (ops: unknown[]) => Promise.all(ops) as Promise<unknown>,
      ),
    };
    service = new CoursesService(prisma as unknown as PrismaService);
  });

  it('always persists status DRAFT regardless of any extraneous input', async () => {
    const dto = { title: 'Intro to TypeScript' } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFT' }) as unknown,
    });
  });

  it('trims title and description before persisting', async () => {
    const dto = {
      title: '  Intro to TypeScript  ',
      description: '  A beginner course  ',
    } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Intro to TypeScript',
        description: 'A beginner course',
        status: 'DRAFT',
      },
    });
  });

  it('passes description through as undefined when not provided', async () => {
    const dto = { title: 'Intro to TypeScript' } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Intro to TypeScript',
        description: undefined,
        status: 'DRAFT',
      },
    });
  });

  describe('findAll', () => {
    it('applies default pagination (page=1, limit=10) when none is supplied', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);

      const result = await service.findAll({});

      expect(prisma.course.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(prisma.course.count).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });

    it('applies custom pagination via skip/take', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);

      await service.findAll({ page: 2, limit: 5 });

      expect(prisma.course.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    it('filters by status when provided', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);

      await service.findAll({
        status: 'PUBLISHED',
      });

      expect(prisma.course.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'PUBLISHED' },
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(prisma.course.count).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'PUBLISHED' },
      });
    });

    it('always excludes soft-deleted courses via deletedAt: null in where', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);

      await service.findAll({});

      const calls = prisma.course.findMany.mock.calls as Array<
        [{ where?: { deletedAt?: unknown; status?: unknown } }]
      >;
      expect(calls[0][0].where?.deletedAt).toBeNull();
      expect(calls[0][0].where?.status).toBeUndefined();
    });

    it('returns an empty data array without error when there are no matches', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(0);

      const result = await service.findAll({});

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('computes totalPages by rounding up (total=11, limit=10 => totalPages=2)', async () => {
      prisma.course.findMany.mockResolvedValue([]);
      prisma.course.count.mockResolvedValue(11);

      const result = await service.findAll({
        limit: 10,
      });

      expect(result.meta.totalPages).toBe(2);
    });
  });

  describe('findOne', () => {
    it('returns the course when prisma finds it', async () => {
      const course = {
        id: 'course-1',
        title: 'Intro to TypeScript',
        description: null,
        status: 'DRAFT',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      prisma.course.findUnique.mockResolvedValue(course);

      const result = await service.findOne('course-1');

      expect(prisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'course-1', deletedAt: null },
      });
      expect(result).toEqual(course);
    });

    it('throws NotFoundException when prisma resolves null', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('excludes soft-deleted courses by filtering deletedAt: null', async () => {
      // A soft-deleted course is treated the same as "not found" at the
      // Prisma layer (deletedAt: null excludes it from the result set), so
      // this asserts the filter is present rather than mocking a deleted row.
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.findOne('deleted-course')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.course.findUnique).toHaveBeenCalledWith({
        where: { id: 'deleted-course', deletedAt: null },
      });
    });
  });

  describe('update', () => {
    const existingCourse = {
      id: 'course-1',
      title: 'Intro to TypeScript',
      description: 'Original description',
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    beforeEach(() => {
      prisma.course.findUnique.mockResolvedValue(existingCourse);
      prisma.course.update.mockResolvedValue(existingCourse);
    });

    it('updates only title when only title is provided', async () => {
      const dto = { title: '  New Title  ' } as UpdateCourseDto;

      await service.update('course-1', dto);

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { title: 'New Title' },
      });
    });

    it('updates only description when only description is provided', async () => {
      const dto = { description: '  New description  ' } as UpdateCourseDto;

      await service.update('course-1', dto);

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { description: 'New description' },
      });
    });

    it('updates both title and description, both trimmed, when both are provided', async () => {
      const dto = {
        title: '  New Title  ',
        description: '  New description  ',
      } as UpdateCourseDto;

      await service.update('course-1', dto);

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { title: 'New Title', description: 'New description' },
      });
    });

    it('treats an explicit null title as "not provided" without crashing', async () => {
      const dto = { title: null } as unknown as UpdateCourseDto;

      await expect(service.update('course-1', dto)).resolves.toEqual(
        existingCourse,
      );
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: {},
      });
    });

    it('treats an explicit null description as "not provided" without crashing', async () => {
      const dto = { description: null } as unknown as UpdateCourseDto;

      await expect(service.update('course-1', dto)).resolves.toEqual(
        existingCourse,
      );
      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: {},
      });
    });

    it('throws NotFoundException and never calls prisma.course.update when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);
      const dto = { title: 'New Title' } as UpdateCourseDto;

      await expect(service.update('missing-id', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const existingCourse = {
      id: 'course-1',
      title: 'Intro to TypeScript',
      description: 'Original description',
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    it('sets deletedAt via prisma.course.update when the course exists', async () => {
      prisma.course.findUnique.mockResolvedValue(existingCourse);
      const deletedCourse = { ...existingCourse, deletedAt: new Date() };
      prisma.course.update.mockResolvedValue(deletedCourse);

      const result = await service.remove('course-1');

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
      expect(result).toEqual(deletedCourse);
    });

    it('throws NotFoundException and never calls prisma.course.update when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    const draftCourse = {
      id: 'course-1',
      title: 'Intro to TypeScript',
      description: 'Original description',
      status: 'DRAFT',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    it('transitions a DRAFT course to PUBLISHED', async () => {
      prisma.course.findUnique.mockResolvedValue(draftCourse);
      const publishedCourse = { ...draftCourse, status: 'PUBLISHED' };
      prisma.course.update.mockResolvedValue(publishedCourse);

      const result = await service.publish('course-1');

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { status: 'PUBLISHED' },
      });
      expect(result).toEqual(publishedCourse);
    });

    it('throws NotFoundException and never calls prisma.course.update when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.publish('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException and never calls prisma.course.update when the course is already PUBLISHED', async () => {
      prisma.course.findUnique.mockResolvedValue({
        ...draftCourse,
        status: 'PUBLISHED',
      });

      await expect(service.publish('course-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });
  });

  describe('unpublish', () => {
    const publishedCourse = {
      id: 'course-1',
      title: 'Intro to TypeScript',
      description: 'Original description',
      status: 'PUBLISHED',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    it('transitions a PUBLISHED course to DRAFT', async () => {
      prisma.course.findUnique.mockResolvedValue(publishedCourse);
      const draftCourse = { ...publishedCourse, status: 'DRAFT' };
      prisma.course.update.mockResolvedValue(draftCourse);

      const result = await service.unpublish('course-1');

      expect(prisma.course.update).toHaveBeenCalledWith({
        where: { id: 'course-1' },
        data: { status: 'DRAFT' },
      });
      expect(result).toEqual(draftCourse);
    });

    it('throws NotFoundException and never calls prisma.course.update when the course does not exist', async () => {
      prisma.course.findUnique.mockResolvedValue(null);

      await expect(service.unpublish('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException and never calls prisma.course.update when the course is already DRAFT', async () => {
      prisma.course.findUnique.mockResolvedValue({
        ...publishedCourse,
        status: 'DRAFT',
      });

      await expect(service.unpublish('course-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.course.update).not.toHaveBeenCalled();
    });
  });
});
