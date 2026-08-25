import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FindCourseLessonsParamsDto } from '../courses/dto/find-course-lessons-params.dto';
import { FindLessonParamsDto } from '../courses/dto/find-lesson-params.dto';
import { MarkLessonProgressDto } from './dto/mark-lesson-progress.dto';
import { ProgressService } from './progress.service';

@ApiTags('progress')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User (any role). Not production auth.',
  required: true,
})
@Controller('courses/:courseId')
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Put('lessons/:lessonId/progress')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Mark/update the caller's completion state for a lesson",
    description:
      "Creates or updates the authenticated caller's own LessonProgress row for the given lesson. The course and lesson must exist (and the lesson must belong to the course), and the caller must be enrolled in the course. Idempotent: calling this repeatedly always returns 200, never 409, since progress rows have no duplicate-conflict semantics like enrollments do. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'lessonId', description: 'Lesson id' })
  @ApiResponse({
    status: 200,
    description: 'The persisted LessonProgress row for the caller',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        lessonId: { type: 'string' },
        completed: { type: 'boolean' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, lesson not found (or belongs to a different course), or the caller is not enrolled in this course',
  })
  markOrUpdate(
    @Param() params: FindLessonParamsDto,
    @Body() dto: MarkLessonProgressDto,
    @CurrentUser() user: User,
  ) {
    return this.progressService.markOrUpdate(
      params.courseId,
      params.lessonId,
      user.id,
      dto.completed,
    );
  }

  @Get('progress')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Retrieve the caller's own progress records for a course",
    description:
      "Returns the authenticated caller's own LessonProgress rows for the given course. The course must exist and the caller must be enrolled in it. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role. Never returns another user's progress records.",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description:
      "The caller's LessonProgress rows for the course, ordered oldest first. Empty array if none exist yet.",
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          lessonId: { type: 'string' },
          completed: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, or the caller is not enrolled in this course',
  })
  findAllForCourse(
    @Param() params: FindCourseLessonsParamsDto,
    @CurrentUser() user: User,
  ) {
    return this.progressService.findAllForCourse(params.courseId, user.id);
  }

  @Get('progress/summary')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Retrieve the caller's own progress summary for a course",
    description:
      "Returns the authenticated caller's own course-level progress summary (total lessons, completed lessons, remaining lessons, completion percentage) for the given course. The course must exist and the caller must be enrolled in it. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role. Never includes another user's progress.",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: "The caller's progress summary for the course",
    schema: {
      type: 'object',
      properties: {
        courseId: { type: 'string' },
        totalLessons: { type: 'number' },
        completedLessons: { type: 'number' },
        remainingLessons: { type: 'number' },
        completionPercentage: { type: 'number' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, or the caller is not enrolled in this course',
  })
  getSummary(
    @Param() params: FindCourseLessonsParamsDto,
    @CurrentUser() user: User,
  ) {
    return this.progressService.getSummary(params.courseId, user.id);
  }
}
