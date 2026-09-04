import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface ReviewResponseBody {
  id: string;
  userId: string;
  courseId: string;
  rating: number;
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedReviewsResponseBody {
  data: ReviewResponseBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface RatingSummaryResponseBody {
  courseId: string;
  averageRating: number | null;
  totalReviews: number;
  ratingDistribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

describe('Course reviews (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  let adminId: string;
  const createdCourseIds: string[] = [];

  const USER_A_EMAIL = 'reviews-e2e-user-a@example.com';
  const USER_B_EMAIL = 'reviews-e2e-user-b@example.com';
  const ADMIN_EMAIL = 'reviews-e2e-admin@example.com';

  const createCourse = async (
    overrides: {
      title?: string;
      status?: 'DRAFT' | 'PUBLISHED';
      deletedAt?: Date;
    } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Course reviews e2e - target course',
        status: overrides.status ?? 'PUBLISHED',
        deletedAt: overrides.deletedAt,
      },
    });
    createdCourseIds.push(course.id);
    return course;
  };

  const enroll = (courseId: string, userId: string) =>
    prisma.enrollment.create({ data: { userId, courseId } });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);

    const userA = await prisma.user.upsert({
      where: { email: USER_A_EMAIL },
      update: { role: 'USER' },
      create: { email: USER_A_EMAIL, role: 'USER' },
    });
    userAId = userA.id;

    const userB = await prisma.user.upsert({
      where: { email: USER_B_EMAIL },
      update: { role: 'USER' },
      create: { email: USER_B_EMAIL, role: 'USER' },
    });
    userBId = userB.id;

    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { role: 'ADMIN' },
      create: { email: ADMIN_EMAIL, role: 'ADMIN' },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    if (createdCourseIds.length > 0) {
      // Review + Enrollment rows cascade-delete with their parent course
      // (onDelete: Cascade), so deleting the courses is sufficient cleanup.
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL, ADMIN_EMAIL] } },
    });
    await app.close();
  });

  describe('POST /courses/:courseId/reviews', () => {
    describe('success', () => {
      it('creates a review for an enrolled user on a PUBLISHED course: 201 with the persisted row', async () => {
        const course = await createCourse({
          title: 'POST review e2e - happy path course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5, content: 'Excellent course' })
          .expect(201);

        const body = response.body as ReviewResponseBody;
        expect(body).toMatchObject({
          userId: userAId,
          courseId: course.id,
          rating: 5,
          content: 'Excellent course',
        });
        expect(body.id).toEqual(expect.any(String));
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();

        const persisted = await prisma.review.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.rating).toBe(5);
      });

      it('creates a review with no content (content is optional)', async () => {
        const course = await createCourse({
          title: 'POST review e2e - no content course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 3 })
          .expect(201);

        const body = response.body as ReviewResponseBody;
        expect(body.content).toBeNull();
      });

      it('persists content as null (not an empty string) when content is whitespace-only', async () => {
        const course = await createCourse({
          title: 'POST review e2e - whitespace content course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4, content: '   ' })
          .expect(201);

        const body = response.body as ReviewResponseBody;
        expect(body.content).toBeNull();
      });
    });

    describe('not found', () => {
      it('returns 404 ("Enrollment not found") when the caller is not enrolled, and creates no row', async () => {
        const course = await createCourse({
          title: 'POST review e2e - not enrolled course',
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Enrollment'));

        const count = await prisma.review.count({
          where: { courseId: course.id },
        });
        expect(count).toBe(0);
      });

      it('returns 404 ("Course not found") for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/reviews')
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(404);
      });
    });

    describe('not published', () => {
      it('returns 403 when the caller is enrolled but the course is DRAFT, and creates no row', async () => {
        const course = await createCourse({
          title: 'POST review e2e - unpublished course',
          status: 'DRAFT',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(403);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(
          expect.stringContaining('not currently available'),
        );

        const count = await prisma.review.count({
          where: { courseId: course.id },
        });
        expect(count).toBe(0);
      });
    });

    describe('admin access', () => {
      it('returns 201 for an ADMIN caller on a PUBLISHED course the admin is not enrolled in', async () => {
        const course = await createCourse({
          title: 'POST review e2e - admin bypass course',
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', adminId)
          .send({ rating: 5 })
          .expect(201);

        const body = response.body as ReviewResponseBody;
        expect(body.userId).toBe(adminId);
      });
    });

    describe('validation failures', () => {
      it('returns 400 when rating is missing', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({})
          .expect(400);
      });

      it('returns 400 when rating is not an integer', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4.5 })
          .expect(400);
      });

      it('returns 400 when rating is below 1', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 0 })
          .expect(400);
      });

      it('returns 400 when rating is above 5', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 6 })
          .expect(400);
      });

      it('returns 400 when content is longer than 2000 characters', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5, content: 'a'.repeat(2001) })
          .expect(400);
      });

      it('returns 400 for an extraneous field (e.g. a spoofed userId)', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5, userId: userBId })
          .expect(400);
      });
    });

    describe('conflict', () => {
      it('returns 409 on a duplicate review by the same user, and does not create a second row', async () => {
        const course = await createCourse({
          title: 'POST review e2e - duplicate course',
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 3 })
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/reviews`,
          timestamp: expect.any(String) as string,
        });

        const count = await prisma.review.count({
          where: { courseId: course.id, userId: userAId },
        });
        expect(count).toBe(1);
      });

      it('race condition: 2 concurrent creates for the same (user, course) yield exactly one 201 and one 409', async () => {
        const course = await createCourse({
          title: 'POST review e2e - race condition course',
        });
        await enroll(course.id, userAId);

        const [first, second] = await Promise.all([
          request(app.getHttpServer())
            .post(`/courses/${course.id}/reviews`)
            .set('x-user-id', userAId)
            .send({ rating: 4 }),
          request(app.getHttpServer())
            .post(`/courses/${course.id}/reviews`)
            .set('x-user-id', userAId)
            .send({ rating: 2 }),
        ]);

        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual([201, 409]);

        const count = await prisma.review.count({
          where: { courseId: course.id, userId: userAId },
        });
        expect(count).toBe(1);
      });
    });

    describe('authn failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .send({ rating: 5 })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/reviews`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ rating: 5 })
          .expect(401);
      });
    });
  });

  describe('PATCH /courses/:courseId/reviews/:reviewId', () => {
    describe('success', () => {
      it("updates the author's own rating/content: 200 with the updated row", async () => {
        const course = await createCourse({
          title: 'PATCH review e2e - author course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 3, content: 'Ok course' })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', userAId)
          .send({ rating: 5, content: 'Actually great' })
          .expect(200);

        const body = response.body as ReviewResponseBody;
        expect(body).toMatchObject({ rating: 5, content: 'Actually great' });
      });

      it('allows an ADMIN to update a review authored by someone else', async () => {
        const course = await createCourse({
          title: 'PATCH review e2e - admin course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 2 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', adminId)
          .send({ rating: 1 })
          .expect(200);

        expect((response.body as ReviewResponseBody).rating).toBe(1);
      });
    });

    describe('not found / authz', () => {
      it('returns 404 (not 403) when a different, non-admin user tries to update the review', async () => {
        const course = await createCourse({
          title: 'PATCH review e2e - other user course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', userBId)
          .send({ rating: 1 })
          .expect(404);

        const persisted = await prisma.review.findUnique({
          where: { id: reviewId },
        });
        expect(persisted?.rating).toBe(4);
      });

      it('returns 404 for a non-existent reviewId', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/nonexistent-review-id`)
          .set('x-user-id', userAId)
          .send({ rating: 1 })
          .expect(404);
      });

      it('returns 404 when the reviewId belongs to a different course than the URL', async () => {
        const courseA = await createCourse({
          title: 'PATCH review e2e - course A',
        });
        const courseB = await createCourse({
          title: 'PATCH review e2e - course B',
        });
        await enroll(courseA.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${courseA.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .patch(`/courses/${courseB.id}/reviews/${reviewId}`)
          .set('x-user-id', userAId)
          .send({ rating: 1 })
          .expect(404);
      });
    });

    describe('validation failures', () => {
      it('returns 400 when rating is outside 1-5', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', userAId)
          .send({ rating: 6 })
          .expect(400);
      });
    });

    describe('authn failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createCourse();
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/reviews/${reviewId}`)
          .send({ rating: 1 })
          .expect(401);
      });
    });
  });

  describe('DELETE /courses/:courseId/reviews/:reviewId', () => {
    describe('success', () => {
      it("deletes the author's own review: 200, and it disappears from the list and summary", async () => {
        const course = await createCourse({
          title: 'DELETE review e2e - author course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', userAId)
          .expect(200);

        const persisted = await prisma.review.findUnique({
          where: { id: reviewId },
        });
        expect(persisted).toBeNull();

        const list = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .expect(200);
        expect(
          (list.body as PaginatedReviewsResponseBody).data.map((r) => r.id),
        ).not.toContain(reviewId);

        const summary = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews/summary`)
          .set('x-user-id', userAId)
          .expect(200);
        expect((summary.body as RatingSummaryResponseBody).totalReviews).toBe(
          0,
        );
      });

      it('allows an ADMIN to delete a review authored by someone else', async () => {
        const course = await createCourse({
          title: 'DELETE review e2e - admin course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', adminId)
          .expect(200);

        const persisted = await prisma.review.findUnique({
          where: { id: reviewId },
        });
        expect(persisted).toBeNull();
      });
    });

    describe('not found / authz', () => {
      it('returns 404 (not 403) when a different, non-admin user tries to delete the review', async () => {
        const course = await createCourse({
          title: 'DELETE review e2e - other user course',
        });
        await enroll(course.id, userAId);
        const created = await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);
        const reviewId = (created.body as ReviewResponseBody).id;

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/reviews/${reviewId}`)
          .set('x-user-id', userBId)
          .expect(404);

        const persisted = await prisma.review.findUnique({
          where: { id: reviewId },
        });
        expect(persisted).not.toBeNull();
      });
    });
  });

  describe('GET /courses/:courseId/reviews', () => {
    describe('success', () => {
      it('returns paginated reviews with the standard {data, meta} shape', async () => {
        const course = await createCourse({
          title: 'GET reviews e2e - pagination course',
        });
        await enroll(course.id, userAId);
        await enroll(course.id, userBId);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userBId)
          .send({ rating: 3 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as PaginatedReviewsResponseBody;
        expect(body.meta).toEqual({
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        });
        expect(body.data).toHaveLength(2);
      });

      it('honors page/limit and caps limit at 100', async () => {
        const course = await createCourse({
          title: 'GET reviews e2e - limit course',
        });
        await enroll(course.id, userAId);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 4 })
          .expect(201);

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews?limit=101`)
          .set('x-user-id', userAId)
          .expect(400);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews?page=1&limit=100`)
          .set('x-user-id', userAId)
          .expect(200);
        expect((response.body as PaginatedReviewsResponseBody).meta.limit).toBe(
          100,
        );
      });

      it('returns an empty list (not an error) when the course has no reviews', async () => {
        const course = await createCourse({
          title: 'GET reviews e2e - empty course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as PaginatedReviewsResponseBody;
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
      });

      it('does not require the caller to be enrolled', async () => {
        const course = await createCourse({
          title: 'GET reviews e2e - no enrollment course',
        });
        await enroll(course.id, userAId);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .set('x-user-id', userBId)
          .expect(200);

        expect(
          (response.body as PaginatedReviewsResponseBody).data,
        ).toHaveLength(1);
      });
    });

    describe('not found', () => {
      it('returns 404 for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/reviews')
          .set('x-user-id', userAId)
          .expect(404);
      });

      it('returns 404 for a DRAFT course when the caller is not an admin', async () => {
        const course = await createCourse({
          title: 'GET reviews e2e - draft course',
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .expect(404);
      });
    });

    describe('authn failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/reviews`,
          timestamp: expect.any(String) as string,
        });
      });
    });
  });

  describe('GET /courses/:courseId/reviews/summary', () => {
    describe('success', () => {
      it('returns the correct average (rounded to 1 decimal) and rating distribution', async () => {
        const course = await createCourse({
          title: 'GET summary e2e - distribution course',
        });
        const userC = await prisma.user.upsert({
          where: { email: 'reviews-e2e-user-c@example.com' },
          update: { role: 'USER' },
          create: { email: 'reviews-e2e-user-c@example.com', role: 'USER' },
        });
        await enroll(course.id, userAId);
        await enroll(course.id, userBId);
        await enroll(course.id, userC.id);

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userBId)
          .send({ rating: 4 })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userC.id)
          .send({ rating: 4 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as RatingSummaryResponseBody;
        expect(body.totalReviews).toBe(3);
        expect(body.averageRating).toBeCloseTo(4.3, 1);
        expect(body.ratingDistribution).toEqual({
          1: 0,
          2: 0,
          3: 0,
          4: 2,
          5: 1,
        });
        const distributionSum = Object.values(body.ratingDistribution).reduce(
          (sum, count) => sum + count,
          0,
        );
        expect(distributionSum).toBe(body.totalReviews);

        await prisma.user.deleteMany({ where: { id: userC.id } });
      });

      it('returns averageRating null, totalReviews 0, and an all-zero distribution for a course with no reviews', async () => {
        const course = await createCourse({
          title: 'GET summary e2e - zero-review course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          averageRating: null,
          totalReviews: 0,
          ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        });
      });

      it('does not require the caller to be enrolled', async () => {
        const course = await createCourse({
          title: 'GET summary e2e - no enrollment course',
        });
        await enroll(course.id, userAId);
        await request(app.getHttpServer())
          .post(`/courses/${course.id}/reviews`)
          .set('x-user-id', userAId)
          .send({ rating: 5 })
          .expect(201);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews/summary`)
          .set('x-user-id', userBId)
          .expect(200);

        expect((response.body as RatingSummaryResponseBody).totalReviews).toBe(
          1,
        );
      });
    });

    describe('not found', () => {
      it('returns 404 for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/reviews/summary')
          .set('x-user-id', userAId)
          .expect(404);
      });

      it('returns 404 for a DRAFT course when the caller is not an admin', async () => {
        const course = await createCourse({
          title: 'GET summary e2e - draft course',
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/reviews/summary`)
          .set('x-user-id', userAId)
          .expect(404);
      });
    });
  });

  describe('Course Detail (GET /courses/:id) is unaffected by this feature', () => {
    it('response has no rating summary fields — only the pre-existing course keys', async () => {
      const course = await createCourse({
        title: 'Course detail e2e - unaffected course',
      });
      await enroll(course.id, userAId);
      await request(app.getHttpServer())
        .post(`/courses/${course.id}/reviews`)
        .set('x-user-id', userAId)
        .send({ rating: 5 })
        .expect(201);

      // GET /courses/:id is AdminGuard-only (see courses.controller.ts) —
      // unrelated to this feature's own AuthGuard-only routes, but the
      // caller here must be an admin to reach the route at all.
      const response = await request(app.getHttpServer())
        .get(`/courses/${course.id}`)
        .set('x-user-id', adminId)
        .expect(200);

      expect(Object.keys(response.body as object).sort()).toEqual(
        [
          'id',
          'title',
          'description',
          'status',
          'instructorId',
          'categoryId',
          'createdAt',
          'updatedAt',
          'deletedAt',
        ].sort(),
      );
    });
  });

  describe('database constraint', () => {
    it('rejects a direct duplicate (userId, courseId) insert at the DB level with a P2002 error', async () => {
      const course = await createCourse({
        title: 'DB constraint e2e - duplicate review course',
      });

      await prisma.review.create({
        data: { userId: userAId, courseId: course.id, rating: 5 },
      });

      const duplicateInsert = prisma.review.create({
        data: { userId: userAId, courseId: course.id, rating: 1 },
      });

      await expect(duplicateInsert).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('cascade delete', () => {
    it('hard-deleting a course with existing reviews removes the review rows (no FK error)', async () => {
      const course = await prisma.course.create({
        data: {
          title: 'Cascade e2e - course delete course',
          status: 'PUBLISHED',
        },
      });
      const review = await prisma.review.create({
        data: { userId: userAId, courseId: course.id, rating: 4 },
      });

      await prisma.course.delete({ where: { id: course.id } });

      const persisted = await prisma.review.findUnique({
        where: { id: review.id },
      });
      expect(persisted).toBeNull();
    });

    it('hard-deleting a user with existing reviews removes the review rows (no FK error)', async () => {
      const throwawayUser = await prisma.user.create({
        data: { email: 'reviews-e2e-throwaway@example.com', role: 'USER' },
      });
      const course = await prisma.course.create({
        data: {
          title: 'Cascade e2e - user delete course',
          status: 'PUBLISHED',
        },
      });
      createdCourseIds.push(course.id);
      const review = await prisma.review.create({
        data: { userId: throwawayUser.id, courseId: course.id, rating: 4 },
      });

      await prisma.user.delete({ where: { id: throwawayUser.id } });

      const persisted = await prisma.review.findUnique({
        where: { id: review.id },
      });
      expect(persisted).toBeNull();
    });
  });
});
