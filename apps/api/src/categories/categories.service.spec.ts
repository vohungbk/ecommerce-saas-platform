import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CategoriesService', () => {
  let prisma: {
    category: {
      create: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let service: CategoriesService;

  beforeEach(() => {
    prisma = {
      category: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new CategoriesService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('creates a category with the given name', async () => {
      const dto = { name: 'Web Development' };
      const created = {
        id: 'category-1',
        name: 'Web Development',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.category.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(prisma.category.create).toHaveBeenCalledWith({
        data: { name: 'Web Development' },
      });
      expect(result).toEqual(created);
    });

    it('throws ConflictException when prisma reports a P2002 unique constraint violation', async () => {
      const dto = { name: 'Web Development' };
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.category.create.mockRejectedValue(error);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('rethrows an unrelated error unchanged', async () => {
      const dto = { name: 'Web Development' };
      const error = new Error('unexpected db failure');
      prisma.category.create.mockRejectedValue(error);

      await expect(service.create(dto)).rejects.toThrow(error);
    });
  });

  describe('findAll', () => {
    it('returns all categories ordered by name ascending', async () => {
      const categories = [
        {
          id: 'category-1',
          name: 'Backend',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      prisma.category.findMany.mockResolvedValue(categories);

      const result = await service.findAll();

      expect(prisma.category.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(categories);
    });

    it('returns an empty array without error when there are no categories', async () => {
      prisma.category.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });
});
