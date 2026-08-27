import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CourseStatus } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { InstructorGuard } from '../auth/instructor.guard';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { FindCourseParamsDto } from './dto/find-course-params.dto';
import { FindCoursesQueryDto } from './dto/find-courses-query.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@ApiTags('instructor-courses')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing INSTRUCTOR or ADMIN User. Not production auth.',
  required: true,
})
@Controller('instructor/courses')
export class InstructorCoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Create a course owned by the caller (instructor)',
    description:
      'Creates a new course with status DRAFT, owned by the caller. Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiResponse({ status: 201, description: 'Course created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: User) {
    return this.coursesService.createOwned(dto, user.id);
  }

  @Get()
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'List courses owned by the caller (instructor)',
    description:
      "Returns a paginated list of the caller's own courses, optionally filtered by status. Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).",
  })
  @ApiResponse({
    status: 200,
    description: "Paginated list of the caller's own courses",
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              title: { type: 'string', example: 'Intro to TypeScript' },
              description: {
                type: 'string',
                nullable: true,
                example: 'A beginner course covering TypeScript fundamentals.',
              },
              status: { type: 'string', enum: Object.values(CourseStatus) },
              instructorId: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              deletedAt: {
                type: 'string',
                format: 'date-time',
                nullable: true,
              },
            },
          },
        },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            total: { type: 'integer', example: 42 },
            totalPages: { type: 'integer', example: 5 },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  findAll(@Query() query: FindCoursesQueryDto, @CurrentUser() user: User) {
    return this.coursesService.findAllOwned(user.id, query);
  }

  @Get(':id')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Get a course owned by the caller by id (instructor)',
    description:
      'Returns a single course by id, only if owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'id', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The course matching the given id',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', example: 'Intro to TypeScript' },
        description: {
          type: 'string',
          nullable: true,
          example: 'A beginner course covering TypeScript fundamentals.',
        },
        status: { type: 'string', enum: Object.values(CourseStatus) },
        instructorId: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  findOne(@Param() params: FindCourseParamsDto, @CurrentUser() user: User) {
    return this.coursesService.findOneOwned(params.id, user);
  }

  @Patch(':id')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Update a course owned by the caller (instructor)',
    description:
      'Partially updates title and/or description of an existing course by id, only if owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'id', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The updated course',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', example: 'Intro to TypeScript' },
        description: {
          type: 'string',
          nullable: true,
          example: 'A beginner course covering TypeScript fundamentals.',
        },
        status: { type: 'string', enum: Object.values(CourseStatus) },
        instructorId: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  update(
    @Param() params: FindCourseParamsDto,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: User,
  ) {
    return this.coursesService.updateOwned(params.id, dto, user);
  }

  @Delete(':id')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Delete a course owned by the caller (instructor)',
    description:
      'Soft-deletes a course by id (sets deletedAt, does not remove the row), only if owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'id', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The soft-deleted course',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', example: 'Intro to TypeScript' },
        description: {
          type: 'string',
          nullable: true,
          example: 'A beginner course covering TypeScript fundamentals.',
        },
        status: { type: 'string', enum: Object.values(CourseStatus) },
        instructorId: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  remove(@Param() params: FindCourseParamsDto, @CurrentUser() user: User) {
    return this.coursesService.removeOwned(params.id, user);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Publish a course owned by the caller (instructor)',
    description:
      'Transitions a course from DRAFT to PUBLISHED by id, only if owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'id', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The published course',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', example: 'Intro to TypeScript' },
        description: {
          type: 'string',
          nullable: true,
          example: 'A beginner course covering TypeScript fundamentals.',
        },
        status: { type: 'string', enum: Object.values(CourseStatus) },
        instructorId: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  @ApiResponse({ status: 409, description: 'Course is not in DRAFT status' })
  publish(@Param() params: FindCourseParamsDto, @CurrentUser() user: User) {
    return this.coursesService.publishOwned(params.id, user);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Unpublish a course owned by the caller (instructor)',
    description:
      'Transitions a course from PUBLISHED to DRAFT by id, only if owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'id', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The unpublished course',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        title: { type: 'string', example: 'Intro to TypeScript' },
        description: {
          type: 'string',
          nullable: true,
          example: 'A beginner course covering TypeScript fundamentals.',
        },
        status: { type: 'string', enum: Object.values(CourseStatus) },
        instructorId: { type: 'string', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        deletedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  @ApiResponse({
    status: 409,
    description: 'Course is not in PUBLISHED status',
  })
  unpublish(@Param() params: FindCourseParamsDto, @CurrentUser() user: User) {
    return this.coursesService.unpublishOwned(params.id, user);
  }
}
