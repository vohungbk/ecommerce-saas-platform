import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Course, Prisma, Review, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { FindCourseReviewsQueryDto } from './dto/find-course-reviews-query.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

export interface PaginatedReviews {
  data: Review[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface CourseRatingSummary {
  courseId: string;
  averageRating: number | null;
  totalReviews: number;
  ratingDistribution: RatingDistribution;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coursesService: CoursesService,
    private readonly enrollmentsService: EnrollmentsService,
  ) {}

  /**
   * Course-visibility check shared by findAllForCourse/getSummary: the
   * course must exist and be PUBLISHED (404 'Course not found' otherwise),
   * ADMIN bypasses the PUBLISHED check only, never the exists check.
   * Deliberately does NOT check enrollment — unlike
   * EnrollmentsService.assertLearnerAccessToCourse, viewing reviews/summary
   * never requires the caller to be enrolled (Q4 — decided in plan.md).
   */
  private async assertCourseVisible(
    courseId: string,
    user: User,
  ): Promise<Course> {
    const course = await this.coursesService.findOne(courseId);

    if (user.role === 'ADMIN') {
      return course;
    }

    if (course.status !== 'PUBLISHED') {
      throw new NotFoundException('Course not found');
    }

    return course;
  }

  async create(
    courseId: string,
    dto: CreateReviewDto,
    user: User,
  ): Promise<Review> {
    // Reused as-is, including ADMIN bypassing enrollment entirely (Q1 —
    // decided in plan.md, not new logic written for reviews).
    await this.enrollmentsService.assertLearnerAccessToCourse(user, courseId);

    try {
      return await this.prisma.review.create({
        data: {
          userId: user.id,
          courseId,
          rating: dto.rating,
          // Empty string after DTO trim is persisted as "not set" (omitted
          // -> NULL in DB), not literal '' (see plan.md E7).
          content: dto.content ? dto.content : undefined,
        },
      });
    } catch (error) {
      // No pre-check findUnique before the insert: the @@unique constraint
      // on (userId, courseId) plus this catch is sufficient, and also
      // covers the race-condition case of two concurrent creates for the
      // same (user, course) pair (see plan.md E5) — same pattern as
      // CategoriesService.create().
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('User has already reviewed this course');
      }
      throw error;
    }
  }

  async findAllForCourse(
    courseId: string,
    query: FindCourseReviewsQueryDto,
    user: User,
  ): Promise<PaginatedReviews> {
    await this.assertCourseVisible(courseId, user);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where: Prisma.ReviewWhereInput = { courseId };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.review.count({ where }),
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

  async getSummary(courseId: string, user: User): Promise<CourseRatingSummary> {
    await this.assertCourseVisible(courseId, user);

    const aggregate = await this.prisma.review.aggregate({
      where: { courseId },
      _avg: { rating: true },
      _count: true,
    });
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { courseId },
      orderBy: { rating: 'asc' },
      _count: { rating: true },
    });

    const totalReviews = aggregate._count;
    // Rating floor is 1, so 0 would be a misleading "average" — null means
    // "no reviews yet" (see plan.md 5/getSummary).
    const averageRating =
      totalReviews === 0
        ? null
        : Math.round((aggregate._avg.rating ?? 0) * 10) / 10;

    const ratingDistribution: RatingDistribution = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    for (const group of grouped) {
      ratingDistribution[group.rating as 1 | 2 | 3 | 4 | 5] =
        group._count.rating;
    }

    return { courseId, averageRating, totalReviews, ratingDistribution };
  }

  /**
   * Confirms a review exists and belongs to courseId in one query — mirrors
   * LessonsService.findOne(courseId, lessonId)'s findFirst-with-compound-where
   * pattern (see plan.md 5/update).
   */
  private async findOwn(courseId: string, reviewId: string): Promise<Review> {
    const review = await this.prisma.review.findFirst({
      where: { id: reviewId, courseId },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    return review;
  }

  /**
   * 404 (not 403) for a non-owner, non-admin caller — mirrors
   * CoursesService.assertOwnerOrAdmin, avoiding an existence leak via a
   * 403-vs-404 side channel (see plan.md E8).
   */
  private assertOwnerOrAdmin(review: Review, user: User): void {
    if (user.role !== 'ADMIN' && review.userId !== user.id) {
      throw new NotFoundException('Review not found');
    }
  }

  async update(
    courseId: string,
    reviewId: string,
    dto: UpdateReviewDto,
    user: User,
  ): Promise<Review> {
    const review = await this.findOwn(courseId, reviewId);
    this.assertOwnerOrAdmin(review, user);

    const data: Prisma.ReviewUpdateInput = {};
    if (dto.rating != null) {
      data.rating = dto.rating;
    }
    if (dto.content != null) {
      // Empty string after DTO trim is persisted as "not set" (NULL), not
      // literal '' (see plan.md E7).
      data.content = dto.content === '' ? null : dto.content;
    }

    return this.prisma.review.update({ where: { id: reviewId }, data });
  }

  async remove(
    courseId: string,
    reviewId: string,
    user: User,
  ): Promise<Review> {
    const review = await this.findOwn(courseId, reviewId);
    this.assertOwnerOrAdmin(review, user);

    return this.prisma.review.delete({ where: { id: reviewId } });
  }
}
