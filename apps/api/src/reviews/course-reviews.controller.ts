import {
  Body,
  Controller,
  Delete,
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
import type { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FindCourseLessonsParamsDto } from '../courses/dto/find-course-lessons-params.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { FindCourseReviewParamsDto } from './dto/find-course-review-params.dto';
import { FindCourseReviewsQueryDto } from './dto/find-course-reviews-query.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';

const REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    courseId: { type: 'string' },
    rating: { type: 'number' },
    content: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('reviews')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User (any role). Not production auth.',
  required: true,
})
@Controller('courses/:courseId/reviews')
export class CourseReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Create the caller's review for a course",
    description:
      'Creates a Review authored by the caller for the given course. The caller must be enrolled in the course and the course must be PUBLISHED (via EnrollmentsService.assertLearnerAccessToCourse — ADMIN callers bypass this entirely, including the enrollment check). A caller may review a course at most once. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 201,
    description: 'The created review',
    schema: REVIEW_SCHEMA,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 403,
    description:
      'The caller is enrolled but the course is not currently PUBLISHED (ADMIN callers bypass this check)',
  })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, or the caller is not enrolled in this course',
  })
  @ApiResponse({
    status: 409,
    description: 'The caller has already reviewed this course',
  })
  create(
    @Param() params: FindCourseLessonsParamsDto,
    @Body() dto: CreateReviewDto,
    @CurrentUser() user: User,
  ) {
    return this.reviewsService.create(params.courseId, dto, user);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'List reviews for a course',
    description:
      'Returns a paginated list of reviews for the given course. The course must exist and be PUBLISHED (ADMIN callers bypass the PUBLISHED check). Does NOT require the caller to be enrolled in the course. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'Paginated reviews for the course',
    schema: {
      type: 'object',
      properties: {
        data: { type: 'array', items: REVIEW_SCHEMA },
        meta: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, or course is not currently PUBLISHED (non-admin callers only)',
  })
  findAllForCourse(
    @Param() params: FindCourseLessonsParamsDto,
    @Query() query: FindCourseReviewsQueryDto,
    @CurrentUser() user: User,
  ) {
    return this.reviewsService.findAllForCourse(params.courseId, query, user);
  }

  @Get('summary')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get the rating summary for a course',
    description:
      'Returns the average rating, total review count, and 1-5 star rating distribution for the given course. The course must exist and be PUBLISHED (ADMIN callers bypass the PUBLISHED check). Does NOT require the caller to be enrolled in the course. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role. This is the only endpoint that exposes aggregated rating data — GET /courses/:id (Course Detail) is unaffected by this feature.',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 200,
    description: 'The rating summary for the course',
    schema: {
      type: 'object',
      properties: {
        courseId: { type: 'string' },
        averageRating: {
          type: 'number',
          nullable: true,
          description:
            'Rounded to 1 decimal place, null if there are no reviews',
        },
        totalReviews: { type: 'number' },
        ratingDistribution: {
          type: 'object',
          properties: {
            1: { type: 'number' },
            2: { type: 'number' },
            3: { type: 'number' },
            4: { type: 'number' },
            5: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Course not found, or course is not currently PUBLISHED (non-admin callers only)',
  })
  getSummary(
    @Param() params: FindCourseLessonsParamsDto,
    @CurrentUser() user: User,
  ) {
    return this.reviewsService.getSummary(params.courseId, user);
  }

  @Patch(':reviewId')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Update the caller's own review (or any review if ADMIN)",
    description:
      "Partially updates a review's rating and/or content. The review must exist and belong to the given course. Only the review's author, or an ADMIN, may update it — any other caller gets a 404 (not 403) to avoid leaking the review's existence (see CoursesService.assertOwnerOrAdmin for the same precedent). Does not re-check enrollment or course-published status. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'reviewId', description: 'Review id' })
  @ApiResponse({
    status: 200,
    description: 'The updated review',
    schema: REVIEW_SCHEMA,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Review not found, review belongs to a different course, or the caller is neither the author nor an ADMIN',
  })
  update(
    @Param() params: FindCourseReviewParamsDto,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() user: User,
  ) {
    return this.reviewsService.update(
      params.courseId,
      params.reviewId,
      dto,
      user,
    );
  }

  @Delete(':reviewId')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "Delete the caller's own review (or any review if ADMIN)",
    description:
      "Deletes a review. The review must exist and belong to the given course. Only the review's author, or an ADMIN, may delete it — any other caller gets a 404 (not 403), same rationale as update. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.",
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiParam({ name: 'reviewId', description: 'Review id' })
  @ApiResponse({
    status: 200,
    description: 'The deleted review',
    schema: REVIEW_SCHEMA,
  })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({
    status: 404,
    description:
      'Review not found, review belongs to a different course, or the caller is neither the author nor an ADMIN',
  })
  remove(
    @Param() params: FindCourseReviewParamsDto,
    @CurrentUser() user: User,
  ) {
    return this.reviewsService.remove(params.courseId, params.reviewId, user);
  }
}
