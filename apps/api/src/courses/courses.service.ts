import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Course, Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { FindCoursesQueryDto } from './dto/find-courses-query.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

export interface PaginatedCourses {
  data: Course[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCourseDto): Promise<Course> {
    return this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        status: 'DRAFT',
      },
    });
  }

  async findAll(query: FindCoursesQueryDto): Promise<PaginatedCourses> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.course.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<Course> {
    const course = await this.prisma.course.findUnique({
      where: { id, deletedAt: null },
    });

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async update(id: string, dto: UpdateCourseDto): Promise<Course> {
    await this.findOne(id);

    const data: Prisma.CourseUpdateInput = {};
    // `null` is treated the same as "field not present": class-validator's
    // `@IsOptional()` skips validation for an explicit `null`, so a
    // strict `!== undefined` check here would let `null` reach `.trim()`
    // and crash. Neither field has a "clear this value" convention (see
    // create-course.dto.ts), so `null`/`undefined` both leave the
    // persisted value unchanged.
    if (dto.title != null) {
      data.title = dto.title.trim();
    }
    if (dto.description != null) {
      data.description = dto.description.trim();
    }

    return this.prisma.course.update({ where: { id }, data });
  }

  async remove(id: string): Promise<Course> {
    await this.findOne(id);

    return this.prisma.course.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async publish(id: string): Promise<Course> {
    const course = await this.findOne(id);

    if (course.status !== 'DRAFT') {
      throw new ConflictException('Only a DRAFT course can be published');
    }

    return this.prisma.course.update({
      where: { id },
      data: { status: 'PUBLISHED' },
    });
  }

  async unpublish(id: string): Promise<Course> {
    const course = await this.findOne(id);

    if (course.status !== 'PUBLISHED') {
      throw new ConflictException('Only a PUBLISHED course can be unpublished');
    }

    return this.prisma.course.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
  }

  // --- Instructor-owned course methods below. Additive only: none of the
  // admin-facing methods above are modified. See instructor-courses.controller.ts
  // for the callers and the plan's D1/D2/D3/D4 design decisions. ---

  createOwned(dto: CreateCourseDto, ownerId: string): Promise<Course> {
    return this.prisma.course.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        status: 'DRAFT',
        instructorId: ownerId,
      },
    });
  }

  async findAllOwned(
    ownerId: string,
    query: FindCoursesQueryDto,
  ): Promise<PaginatedCourses> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      instructorId: ownerId,
      ...(query.status ? { status: query.status } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.course.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.course.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Centralized "may this user manage this course" check (ownership +
   * admin bypass), mirroring
   * `EnrollmentsService.assertLearnerAccessToCourse`. A caller with no
   * ownership relationship to the course gets a 404 (not 403) — see plan
   * Decision D2 — to avoid leaking a course's existence/title/status to an
   * instructor who does not own it via a 403-vs-404 side channel. ADMIN
   * callers always bypass the ownership check.
   */
  async assertOwnerOrAdmin(user: User, courseId: string): Promise<Course> {
    const course = await this.findOne(courseId);

    if (user.role === 'ADMIN') {
      return course;
    }

    if (course.instructorId !== user.id) {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async findOneOwned(id: string, user: User): Promise<Course> {
    await this.assertOwnerOrAdmin(user, id);
    return this.findOne(id);
  }

  async updateOwned(
    id: string,
    dto: UpdateCourseDto,
    user: User,
  ): Promise<Course> {
    await this.assertOwnerOrAdmin(user, id);
    return this.update(id, dto);
  }

  async removeOwned(id: string, user: User): Promise<Course> {
    await this.assertOwnerOrAdmin(user, id);
    return this.remove(id);
  }

  async publishOwned(id: string, user: User): Promise<Course> {
    await this.assertOwnerOrAdmin(user, id);
    return this.publish(id);
  }

  async unpublishOwned(id: string, user: User): Promise<Course> {
    await this.assertOwnerOrAdmin(user, id);
    return this.unpublish(id);
  }
}
