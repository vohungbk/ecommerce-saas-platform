import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { FindCourseLessonsParamsDto } from './dto/find-course-lessons-params.dto';
import { FindLessonParamsDto } from './dto/find-lesson-params.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { LessonsService } from './lessons.service';

@ApiTags('lessons')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing admin User. Not production auth.',
  required: true,
})
@Controller('courses/:courseId/lessons')
export class LessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Create a lesson for a course (admin only)',
    description:
      'Creates a new lesson under the given course. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({ status: 201, description: 'Lesson created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  create(
    @Param() params: FindCourseLessonsParamsDto,
    @Body() dto: CreateLessonDto,
  ) {
    return this.lessonsService.create(params.courseId, dto);
  }

  @Get()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "List a course's lessons (admin only)",
    description:
      'Returns all lessons for the given course, ordered by creation order. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: "The course's lessons, ordered oldest first",
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          courseId: { type: 'string' },
          title: { type: 'string', example: 'Setting up your environment' },
          description: {
            type: 'string',
            nullable: true,
            example: 'How to install the tools needed for this course.',
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  findAll(@Param() params: FindCourseLessonsParamsDto) {
    return this.lessonsService.findAllForCourse(params.courseId);
  }

  @Get(':lessonId')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Get a lesson by id (admin only)',
    description:
      'Returns a single lesson belonging to the given course. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'lessonId', description: 'Lesson id' })
  @ApiResponse({
    status: 200,
    description: 'The lesson matching the given id',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        courseId: { type: 'string' },
        title: { type: 'string', example: 'Setting up your environment' },
        description: {
          type: 'string',
          nullable: true,
          example: 'How to install the tools needed for this course.',
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or lesson not found',
  })
  findOne(@Param() params: FindLessonParamsDto) {
    return this.lessonsService.findOne(params.courseId, params.lessonId);
  }

  @Patch(':lessonId')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Update a lesson (admin only)',
    description:
      'Partially updates title and/or description of an existing lesson belonging to the given course. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'lessonId', description: 'Lesson id' })
  @ApiResponse({
    status: 200,
    description: 'The updated lesson',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        courseId: { type: 'string' },
        title: { type: 'string', example: 'Setting up your environment' },
        description: {
          type: 'string',
          nullable: true,
          example: 'How to install the tools needed for this course.',
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or lesson not found',
  })
  update(@Param() params: FindLessonParamsDto, @Body() dto: UpdateLessonDto) {
    return this.lessonsService.update(params.courseId, params.lessonId, dto);
  }

  @Delete(':lessonId')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Delete a lesson (admin only)',
    description:
      'Permanently deletes a lesson belonging to the given course. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'lessonId', description: 'Lesson id' })
  @ApiResponse({
    status: 200,
    description: 'The deleted lesson',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        courseId: { type: 'string' },
        title: { type: 'string', example: 'Setting up your environment' },
        description: {
          type: 'string',
          nullable: true,
          example: 'How to install the tools needed for this course.',
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 404,
    description: 'Course not found, or lesson not found',
  })
  remove(@Param() params: FindLessonParamsDto) {
    return this.lessonsService.remove(params.courseId, params.lessonId);
  }
}
