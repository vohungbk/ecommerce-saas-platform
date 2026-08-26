import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface LessonProgressResponseBody {
  id: string;
  userId: string;
  lessonId: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

describe('Course lesson progress (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  let adminId: string;
  const createdCourseIds: string[] = [];

  const USER_A_EMAIL = 'progress-e2e-user-a@example.com';
  const USER_B_EMAIL = 'progress-e2e-user-b@example.com';
  const ADMIN_EMAIL = 'progress-e2e-admin@example.com';

  const createCourse = async (
    overrides: {
      title?: string;
      status?: 'DRAFT' | 'PUBLISHED';
      deletedAt?: Date;
    } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Course progress e2e - target course',
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
      // Lesson + Enrollment + LessonProgress rows cascade-delete with their
      // parent course/lesson (onDelete: Cascade), so deleting the courses is
      // sufficient cleanup.
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL, ADMIN_EMAIL] } },
    });
    await app.close();
  });

  describe('PUT /courses/:courseId/lessons/:lessonId/progress', () => {
    describe('success', () => {
      it('marks a lesson completed (happy path): 200 with the persisted LessonProgress row', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - happy path course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);

        const body = response.body as LessonProgressResponseBody;
        expect(body).toMatchObject({
          userId: userAId,
          lessonId: lesson.id,
          completed: true,
        });
        expect(body.id).toEqual(expect.any(String));
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();

        const persisted = await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId: { userId: userAId, lessonId: lesson.id },
          },
        });
        expect(persisted).not.toBeNull();
        expect(persisted?.completed).toBe(true);
      });

      it('updates the completion state on a repeat call: 200, no duplicate row created', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - update course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        const first = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);
        const firstBody = first.body as LessonProgressResponseBody;
        expect(firstBody.completed).toBe(true);

        const second = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: false })
          .expect(200);
        const secondBody = second.body as LessonProgressResponseBody;
        expect(secondBody.completed).toBe(false);
        expect(secondBody.id).toBe(firstBody.id);

        const count = await prisma.lessonProgress.count({
          where: { userId: userAId, lessonId: lesson.id },
        });
        expect(count).toBe(1);
      });
    });

    describe('not found', () => {
      it('returns 404 ("Enrollment not found") when the caller is not enrolled, and creates no LessonProgress row', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - not enrolled course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.stringContaining('Enrollment') as string,
          path: `/courses/${course.id}/lessons/${lesson.id}/progress`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId: { userId: userAId, lessonId: lesson.id },
          },
        });
        expect(persisted).toBeNull();
      });

      it('returns 404 ("Lesson not found") when the lessonId belongs to a different course than the URL, even if enrolled, and creates no row', async () => {
        const courseA = await createCourse({
          title: 'PUT progress e2e - course A',
        });
        const courseB = await createCourse({
          title: 'PUT progress e2e - course B',
        });
        const lessonInB = await prisma.lesson.create({
          data: { courseId: courseB.id, title: 'Lesson in course B' },
        });
        await enroll(courseA.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${courseA.id}/lessons/${lessonInB.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(404);

        const persisted = await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId: { userId: userAId, lessonId: lessonInB.id },
          },
        });
        expect(persisted).toBeNull();
      });

      it('returns 404 ("Lesson not found") for a well-formed but non-existent lessonId under an enrolled-in course', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - lesson not found course',
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/nonexistent-lesson-id/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(404);
      });

      it('returns 404 ("Course not found") for a non-existent courseId regardless of lessonId or enrollment', async () => {
        await request(app.getHttpServer())
          .put('/courses/nonexistent-course-id/lessons/some-lesson-id/progress')
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(404);
      });

      it('returns 404 ("Course not found") for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - soft-deleted course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(404);
      });
    });

    describe('not published', () => {
      it('returns 403 when the caller is enrolled but the course is DRAFT, and creates no LessonProgress row', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - unpublished course',
          status: 'DRAFT',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(403);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 403,
          error: expect.any(String) as string,
          message: expect.stringContaining('not currently available') as string,
          path: `/courses/${course.id}/lessons/${lesson.id}/progress`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId: { userId: userAId, lessonId: lesson.id },
          },
        });
        expect(persisted).toBeNull();
      });
    });

    describe('admin access', () => {
      it('returns 200 for an ADMIN caller on a DRAFT course the admin is not enrolled in', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - admin bypass course',
          status: 'DRAFT',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', adminId)
          .send({ completed: true })
          .expect(200);

        const body = response.body as LessonProgressResponseBody;
        expect(body).toMatchObject({
          userId: adminId,
          lessonId: lesson.id,
          completed: true,
        });
      });
    });

    describe('user isolation', () => {
      it('read isolation: user B does not see user A progress in GET .../progress', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - read isolation course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);
        await enroll(course.id, userBId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userBId)
          .expect(200);

        expect(response.body).toEqual([]);
      });

      it('write isolation: an extraneous userId in the body is rejected 400, and the persisted row always matches the caller', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - write isolation course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true, userId: userBId })
          .expect(400);

        const persisted = await prisma.lessonProgress.findUnique({
          where: {
            userId_lessonId: { userId: userAId, lessonId: lesson.id },
          },
        });
        expect(persisted).toBeNull();

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);
        const body = response.body as LessonProgressResponseBody;
        expect(body.userId).toBe(userAId);
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing, and creates no row', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - missing header course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .send({ completed: true })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/lessons/${lesson.id}/progress`,
          timestamp: expect.any(String) as string,
        });

        const count = await prisma.lessonProgress.count({
          where: { lessonId: lesson.id },
        });
        expect(count).toBe(0);
      });

      it('returns 401 when the x-user-id header does not match an existing user, and creates no row', async () => {
        const course = await createCourse({
          title: 'PUT progress e2e - unknown user course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ completed: true })
          .expect(401);

        const count = await prisma.lessonProgress.count({
          where: { lessonId: lesson.id },
        });
        expect(count).toBe(0);
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .put('/courses/%20%20/lessons/some-lesson-id/progress')
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(400);
      });

      it('returns 400 for a whitespace-only lessonId', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/%20%20/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(400);
      });

      it('returns 400 for a missing completed field', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({})
          .expect(400);
      });

      it('returns 400 for a non-boolean completed field', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: 'yes' })
          .expect(400);
      });

      it('returns 400 for an extraneous body field', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true, watchTimeSeconds: 30 })
          .expect(400);
      });
    });
  });

  describe('GET /courses/:courseId/progress', () => {
    describe('success', () => {
      it('returns 200 with exactly the caller progress rows for 2 of the course lessons', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - happy path course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        const lesson3 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 3' },
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson1.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);
        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson2.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: false })
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as LessonProgressResponseBody[];
        expect(body).toHaveLength(2);
        expect(body.every((row) => row.userId === userAId)).toBe(true);
        expect(body.map((row) => row.lessonId).sort()).toEqual(
          [lesson1.id, lesson2.id].sort(),
        );
        expect(body.map((row) => row.lessonId)).not.toContain(lesson3.id);
      });

      it('returns 200 with an empty array (not an error) when the caller has no progress rows yet', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - empty course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual([]);
      });
    });

    describe('not found', () => {
      it('returns 404 ("Enrollment not found") when the caller is not enrolled', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - not enrolled course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Enrollment'));
      });

      it('returns 404 ("Course not found") for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/progress')
          .set('x-user-id', userAId)
          .expect(404);
      });

      it('returns 404 ("Course not found") for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - soft-deleted course',
        });
        await enroll(course.id, userAId);
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userAId)
          .expect(404);
      });
    });

    describe('not published', () => {
      it('returns 403 when the caller is enrolled but the course is DRAFT', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - unpublished course',
          status: 'DRAFT',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', userAId)
          .expect(403);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(
          expect.stringContaining('not currently available'),
        );
      });
    });

    describe('admin access', () => {
      it('returns 200 for an ADMIN caller on a DRAFT course the admin is not enrolled in', async () => {
        const course = await createCourse({
          title: 'GET progress e2e - admin bypass course',
          status: 'DRAFT',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', adminId)
          .expect(200);

        expect(response.body).toEqual([]);
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/progress`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/%20%20/progress')
          .set('x-user-id', userAId)
          .expect(400);
      });
    });
  });

  describe('GET /courses/:courseId/progress/summary', () => {
    describe('success', () => {
      it('returns 200 with 0% completion when the caller has no completed lessons', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - 0% course',
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 2,
          completedLessons: 0,
          remainingLessons: 2,
          completionPercentage: 0,
        });
      });

      it('returns 200 with 50% completion when 2 of 4 lessons are completed', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - 50% course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 3' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 4' },
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson1.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);
        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson2.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 4,
          completedLessons: 2,
          remainingLessons: 2,
          completionPercentage: 50,
        });
      });

      it('returns 200 with 100% completion when all lessons are completed', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - 100% course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson1.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);
        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson2.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 2,
          completedLessons: 2,
          remainingLessons: 0,
          completionPercentage: 100,
        });
      });

      it('returns 200 with all-zero totals (not NaN/500) for a zero-lesson course', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - zero-lesson course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 0,
          completedLessons: 0,
          remainingLessons: 0,
          completionPercentage: 0,
        });
      });
    });

    describe('not found', () => {
      it('returns 404 ("Enrollment not found") when the caller is not enrolled', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - not enrolled course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Enrollment'));
      });

      it('returns 404 ("Course not found") for a non-existent courseId', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/progress/summary')
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Course'));
      });

      it('returns 404 ("Course not found") for a soft-deleted course, even if the caller is enrolled', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - soft-deleted course',
        });
        await enroll(course.id, userAId);
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Course'));
      });
    });

    describe('user isolation', () => {
      it("user B's summary reflects only user B's own completions, not user A's", async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - isolation course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);
        await enroll(course.id, userBId);

        await request(app.getHttpServer())
          .put(`/courses/${course.id}/lessons/${lesson1.id}/progress`)
          .set('x-user-id', userAId)
          .send({ completed: true })
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userBId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 2,
          completedLessons: 0,
          remainingLessons: 2,
          completionPercentage: 0,
        });
      });
    });

    describe('not published', () => {
      it('returns 403 when the caller is enrolled but the course is DRAFT', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - unpublished course',
          status: 'DRAFT',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', userAId)
          .expect(403);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(
          expect.stringContaining('not currently available'),
        );
      });
    });

    describe('admin access', () => {
      it('returns 200 for an ADMIN caller on a DRAFT course the admin is not enrolled in', async () => {
        const course = await createCourse({
          title: 'GET progress summary e2e - admin bypass course',
          status: 'DRAFT',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', adminId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          totalLessons: 0,
          completedLessons: 0,
          remainingLessons: 0,
          completionPercentage: 0,
        });
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/progress/summary`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/progress/summary`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/%20%20/progress/summary')
          .set('x-user-id', userAId)
          .expect(400);
      });
    });
  });

  describe('database constraint', () => {
    it('rejects a direct duplicate (userId, lessonId) insert at the DB level with a P2002 error', async () => {
      const course = await createCourse({
        title: 'DB constraint e2e - duplicate progress course',
      });
      const lesson = await prisma.lesson.create({
        data: { courseId: course.id, title: 'Lesson 1' },
      });

      await prisma.lessonProgress.create({
        data: { userId: userAId, lessonId: lesson.id, completed: true },
      });

      const duplicateInsert = prisma.lessonProgress.create({
        data: { userId: userAId, lessonId: lesson.id, completed: false },
      });

      await expect(duplicateInsert).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  describe('cascade delete regression', () => {
    it('deleting a lesson with existing progress rows succeeds and removes the progress row (no FK error)', async () => {
      const course = await createCourse({
        title: 'Cascade e2e - lesson delete course',
      });
      const lesson = await prisma.lesson.create({
        data: { courseId: course.id, title: 'Lesson to delete' },
      });
      await prisma.lessonProgress.create({
        data: { userId: userAId, lessonId: lesson.id, completed: true },
      });

      await prisma.lesson.delete({ where: { id: lesson.id } });

      const persisted = await prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: userAId, lessonId: lesson.id } },
      });
      expect(persisted).toBeNull();
    });

    it('deleting (soft-deleting via cascade at the course level is not applicable, but hard-deleting) a course with existing progress rows succeeds', async () => {
      const course = await prisma.course.create({
        data: {
          title: 'Cascade e2e - course delete course',
          status: 'PUBLISHED',
        },
      });
      const lesson = await prisma.lesson.create({
        data: { courseId: course.id, title: 'Lesson 1' },
      });
      await prisma.lessonProgress.create({
        data: { userId: userAId, lessonId: lesson.id, completed: true },
      });

      await prisma.course.delete({ where: { id: course.id } });

      const persisted = await prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: userAId, lessonId: lesson.id } },
      });
      expect(persisted).toBeNull();
    });
  });
});
