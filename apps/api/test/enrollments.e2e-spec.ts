import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface EnrollmentResponseBody {
  id: string;
  userId: string;
  courseId: string;
  createdAt: string;
}

interface EnrollmentWithCourseResponseBody extends EnrollmentResponseBody {
  course: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

describe('Enrollments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  const createdCourseIds: string[] = [];

  const USER_A_EMAIL = 'enrollments-e2e-user-a@example.com';
  const USER_B_EMAIL = 'enrollments-e2e-user-b@example.com';

  const createCourse = async (
    overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Enrollments e2e - target course',
        status: overrides.status ?? 'PUBLISHED',
      },
    });
    createdCourseIds.push(course.id);
    return course;
  };

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
  });

  afterAll(async () => {
    if (createdCourseIds.length > 0) {
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL] } },
    });
    await app.close();
  });

  describe('POST /courses/:courseId/enroll', () => {
    describe('success', () => {
      it('enrolls the caller in a PUBLISHED course: returns 201 and persists an Enrollment row', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(201);

        const body = response.body as EnrollmentResponseBody;
        expect(body).toMatchObject({
          userId: userAId,
          courseId: course.id,
        });
        expect(body.id).toEqual(expect.any(String));
        expect(body.createdAt).toBeDefined();

        const persisted = await prisma.enrollment.findUnique({
          where: {
            userId_courseId: { userId: userAId, courseId: course.id },
          },
        });
        expect(persisted).not.toBeNull();
        expect(persisted?.id).toBe(body.id);

        await prisma.enrollment.deleteMany({
          where: { userId: userAId, courseId: course.id },
        });
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent courseId', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/enroll')
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/enroll',
          timestamp: expect.any(String) as string,
        });
      });
    });

    describe('conflict', () => {
      it('returns 409 and creates no Enrollment row when the course is DRAFT', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/enroll`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.enrollment.findUnique({
          where: {
            userId_courseId: { userId: userAId, courseId: course.id },
          },
        });
        expect(persisted).toBeNull();
      });

      it('returns 409 on a duplicate enrollment: first call 201, second call 409, and only one row exists', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(201);

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/enroll`,
          timestamp: expect.any(String) as string,
        });

        const count = await prisma.enrollment.count({
          where: { userId: userAId, courseId: course.id },
        });
        expect(count).toBe(1);
      });
    });

    describe('validation failures', () => {
      it('returns 400 with the standard error shape for a whitespace-only courseId', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/%20%20/enroll')
          .set('x-user-id', userAId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing, and creates no Enrollment row', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/enroll`,
          timestamp: expect.any(String) as string,
        });

        const count = await prisma.enrollment.count({
          where: { courseId: course.id },
        });
        expect(count).toBe(0);
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });
  });

  describe('GET /enrollments', () => {
    beforeAll(async () => {
      // Earlier describe blocks in this file (POST /courses/:courseId/enroll)
      // create enrollments for userA/userB as a side effect of exercising
      // the enroll endpoint and don't all clean up after themselves. This
      // block owns Enrollment rows for userA/userB from this point on, so
      // reset to a known-empty state before asserting on list contents.
      await prisma.enrollment.deleteMany({
        where: { userId: { in: [userAId, userBId] } },
      });
    });

    describe('success', () => {
      it('returns 200 with an empty array (not an error) when the caller has no enrollments', async () => {
        const response = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual([]);
      });

      it('returns the caller enrollments including the nested course, scoped to that caller only', async () => {
        const course1 = await createCourse({
          title: 'GET /enrollments e2e - course 1',
          status: 'PUBLISHED',
        });
        const course2 = await createCourse({
          title: 'GET /enrollments e2e - course 2',
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/courses/${course1.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(201);
        await request(app.getHttpServer())
          .post(`/courses/${course2.id}/enroll`)
          .set('x-user-id', userAId)
          .expect(201);

        const response = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as EnrollmentWithCourseResponseBody[];
        expect(body).toHaveLength(2);
        expect(body.every((e) => e.userId === userAId)).toBe(true);
        expect(body.map((e) => e.courseId).sort()).toEqual(
          [course1.id, course2.id].sort(),
        );
        const withCourse1 = body.find((e) => e.courseId === course1.id);
        expect(withCourse1?.course).toMatchObject({
          id: course1.id,
          title: course1.title,
          status: 'PUBLISHED',
        });

        await prisma.enrollment.deleteMany({
          where: {
            userId: userAId,
            courseId: { in: [course1.id, course2.id] },
          },
        });
      });

      it('user isolation: user A never receives user B enrollments', async () => {
        const course = await createCourse({
          title: 'GET /enrollments e2e - isolation target',
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/enroll`)
          .set('x-user-id', userBId)
          .expect(201);

        const response = await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual([]);

        await prisma.enrollment.deleteMany({
          where: { userId: userBId, courseId: course.id },
        });
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .get('/enrollments')
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/enrollments',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .get('/enrollments')
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });
  });

  describe('database constraint', () => {
    it('rejects a direct duplicate (userId, courseId) insert at the DB level with a P2002 error', async () => {
      const course = await createCourse({ status: 'PUBLISHED' });

      await prisma.enrollment.create({
        data: { userId: userAId, courseId: course.id },
      });

      const duplicateInsert = prisma.enrollment.create({
        data: { userId: userAId, courseId: course.id },
      });

      await expect(duplicateInsert).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });

      await prisma.enrollment.deleteMany({
        where: { userId: userAId, courseId: course.id },
      });
    });
  });
});
