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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { InstructorGuard } from '../auth/instructor.guard';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { FindCourseLessonsParamsDto } from './dto/find-course-lessons-params.dto';
import { FindLessonParamsDto } from './dto/find-lesson-params.dto';
import { ReorderLessonsDto } from './dto/reorder-lessons.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { LessonsService } from './lessons.service';

@ApiTags('instructor-lessons')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing INSTRUCTOR or ADMIN User. Not production auth.',
  required: true,
})
@Controller('instructor/courses/:courseId/lessons')
export class InstructorLessonsController {
  constructor(private readonly lessonsService: LessonsService) {}

  @Post()
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Create a lesson for a course owned by the caller (instructor)',
    description:
      'Creates a new lesson under the given course, only if the course is owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({ status: 201, description: 'Lesson created' })
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
  create(
    @Param() params: FindCourseLessonsParamsDto,
    @Body() dto: CreateLessonDto,
    @CurrentUser() user: User,
  ) {
    return this.lessonsService.createOwned(params.courseId, dto, user);
  }

  @Get()
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary:
      "List a course's lessons for a course owned by the caller (instructor)",
    description:
      'Returns all lessons for the given course, ordered by creation order, only if the course is owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
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
          position: { type: 'integer', example: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
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
  @ApiResponse({
    status: 404,
    description: 'Course not found, or not owned by the caller',
  })
  findAll(
    @Param() params: FindCourseLessonsParamsDto,
    @CurrentUser() user: User,
  ) {
    return this.lessonsService.findAllForCourseOwned(params.courseId, user);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary:
      "Reorder a course's lessons for a course owned by the caller (instructor)",
    description:
      "Persists a full reordering of the course's lessons, only if the course is owned by the caller (ADMIN bypasses ownership). The request must list every lesson currently belonging to the course, each with a unique target position. Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiBody({ type: ReorderLessonsDto })
  @ApiResponse({
    status: 200,
    description: "The course's lessons in their new persisted order",
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
          position: { type: 'integer', example: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Validation failed, duplicate id/position in the payload, or the payload does not include all of the course's lessons",
  })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an instructor or admin',
  })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, not owned by the caller, or a lesson id does not belong to this course',
  })
  reorder(
    @Param() params: FindCourseLessonsParamsDto,
    @Body() dto: ReorderLessonsDto,
    @CurrentUser() user: User,
  ) {
    return this.lessonsService.reorderOwned(params.courseId, dto, user);
  }

  @Get(':lessonId')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Get a lesson by id for a course owned by the caller (instructor)',
    description:
      'Returns a single lesson belonging to the given course, only if the course is owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
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
        position: { type: 'integer', example: 1 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
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
    description:
      'Course not found, not owned by the caller, or lesson not found',
  })
  findOne(@Param() params: FindLessonParamsDto, @CurrentUser() user: User) {
    return this.lessonsService.findOneOwned(
      params.courseId,
      params.lessonId,
      user,
    );
  }

  @Patch(':lessonId')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Update a lesson for a course owned by the caller (instructor)',
    description:
      'Partially updates title and/or description of an existing lesson belonging to the given course, only if the course is owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
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
        position: { type: 'integer', example: 1 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
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
    description:
      'Course not found, not owned by the caller, or lesson not found',
  })
  update(
    @Param() params: FindLessonParamsDto,
    @Body() dto: UpdateLessonDto,
    @CurrentUser() user: User,
  ) {
    return this.lessonsService.updateOwned(
      params.courseId,
      params.lessonId,
      dto,
      user,
    );
  }

  @Delete(':lessonId')
  @UseGuards(InstructorGuard)
  @ApiOperation({
    summary: 'Delete a lesson for a course owned by the caller (instructor)',
    description:
      'Permanently deletes a lesson belonging to the given course, only if the course is owned by the caller (ADMIN bypasses ownership). Requires the caller to be an instructor or admin (development-only x-user-id header shim, see InstructorGuard).',
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
        position: { type: 'integer', example: 1 },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
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
    description:
      'Course not found, not owned by the caller, or lesson not found',
  })
  remove(@Param() params: FindLessonParamsDto, @CurrentUser() user: User) {
    return this.lessonsService.removeOwned(
      params.courseId,
      params.lessonId,
      user,
    );
  }
}
