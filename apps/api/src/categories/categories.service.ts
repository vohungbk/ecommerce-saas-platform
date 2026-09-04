import { ConflictException, Injectable } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    try {
      return await this.prisma.category.create({
        data: { name: dto.name },
      });
    } catch (error) {
      // No pre-check findUnique before the insert: the @unique constraint
      // on `name` plus this catch is sufficient and avoids an unnecessary
      // extra read before every create (see plan.md 4.2).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Category with this name already exists');
      }
      throw error;
    }
  }

  findAll(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }
}
