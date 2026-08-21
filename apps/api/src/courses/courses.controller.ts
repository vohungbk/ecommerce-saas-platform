import {
  Body,
  Controller,
  Get,
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
import { AdminGuard } from '../auth/admin.guard';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { FindCourseParamsDto } from './dto/find-course-params.dto';
import { FindCoursesQueryDto } from './dto/find-courses-query.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

@ApiTags('courses')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing admin User. Not production auth.',
  required: true,
})
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Create a course (admin only)',
    description:
      'Creates a new course with status DRAFT. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiResponse({ status: 201, description: 'Course created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  create(@Body() dto: CreateCourseDto) {
    return this.coursesService.create(dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List courses (admin only)',
    description:
      'Returns a paginated list of courses, optionally filtered by status. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of courses',
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
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
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
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  findAll(@Query() query: FindCoursesQueryDto) {
    return this.coursesService.findAll(query);
  }

  @Get(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get a course by id (admin only)',
    description:
      'Returns a single course by id. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
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
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  findOne(@Param() params: FindCourseParamsDto) {
    return this.coursesService.findOne(params.id);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Update a course (admin only)',
    description:
      'Partially updates title and/or description of an existing course by id. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
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
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  update(@Param() params: FindCourseParamsDto, @Body() dto: UpdateCourseDto) {
    return this.coursesService.update(params.id, dto);
  }
}
