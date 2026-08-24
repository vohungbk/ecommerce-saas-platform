import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface LessonResponseBody {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
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

describe('Course lessons (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminId: string;
  let nonAdminId: string;
  const createdCourseIds: string[] = [];

  const ADMIN_EMAIL = 'course-lessons-e2e-admin@example.com';
  const NON_ADMIN_EMAIL = 'course-lessons-e2e-user@example.com';

  const createCourse = async (
    overrides: {
      title?: string;
      status?: 'DRAFT' | 'PUBLISHED';
      deletedAt?: Date;
    } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Course lessons e2e - target course',
        status: overrides.status ?? 'PUBLISHED',
        deletedAt: overrides.deletedAt,
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

    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { role: 'ADMIN' },
      create: { email: ADMIN_EMAIL, role: 'ADMIN' },
    });
    adminId = admin.id;

    const nonAdmin = await prisma.user.upsert({
      where: { email: NON_ADMIN_EMAIL },
      update: { role: 'USER' },
      create: { email: NON_ADMIN_EMAIL, role: 'USER' },
    });
    nonAdminId = nonAdmin.id;
  });

  afterAll(async () => {
    if (createdCourseIds.length > 0) {
      // Lesson rows cascade-delete with their parent course (onDelete:
      // Cascade), so deleting the courses is sufficient cleanup.
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN_EMAIL, NON_ADMIN_EMAIL] } },
    });
    await app.close();
  });

  describe('POST /courses/:courseId/lessons', () => {
    let courseId: string;

    beforeAll(async () => {
      const course = await createCourse({
        title: 'POST lessons e2e - target course',
      });
      courseId = course.id;
    });

    describe('success', () => {
      it('creates a lesson with just a title', async () => {
        const response = await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'Lesson 1' })
          .expect(201);

        const body = response.body as LessonResponseBody;

        expect(body).toMatchObject({
          courseId,
          title: 'Lesson 1',
        });
        expect(body.id).toEqual(expect.any(String));
        expect(body.description).toBeNull();
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();

        const persisted = await prisma.lesson.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.courseId).toBe(courseId);
        expect(persisted?.title).toBe('Lesson 1');
      });

      it('persists the supplied description', async () => {
        const response = await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'Lesson with description', description: 'Details' })
          .expect(201);

        const body = response.body as LessonResponseBody;
        expect(body.description).toBe('Details');
      });
    });

    describe('validation failures', () => {
      it('rejects a missing title', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({})
          .expect(400);
      });

      it('rejects a title shorter than 3 characters', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'ab' })
          .expect(400);
      });

      it('rejects a title longer than 200 characters', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'a'.repeat(201) })
          .expect(400);
      });

      it('rejects a whitespace-only title', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: '   ' })
          .expect(400);
      });

      it('rejects an extraneous field', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'Valid Title', order: 1 })
          .expect(400);
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a non-existent courseId, and creates no Lesson row', async () => {
        const beforeCount = await prisma.lesson.count();

        const response = await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/lessons')
          .set('x-user-id', adminId)
          .send({ title: 'Lesson 1' })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/lessons',
          timestamp: expect.any(String) as string,
        });

        const afterCount = await prisma.lesson.count();
        expect(afterCount).toBe(beforeCount);
      });

      it('returns 404 with the standard error shape for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'POST lessons e2e - soft-deleted course',
        });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'Lesson 1' })
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .send({ title: 'Lesson 1' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${courseId}/lessons`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ title: 'Lesson 1' })
          .expect(401);
      });

      it('returns 403 for a non-admin user and does not create a Lesson row', async () => {
        const beforeCount = await prisma.lesson.count();

        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons`)
          .set('x-user-id', nonAdminId)
          .send({ title: 'Lesson 1' })
          .expect(403);

        const afterCount = await prisma.lesson.count();
        expect(afterCount).toBe(beforeCount);
      });
    });
  });

  describe('GET /courses/:courseId/lessons', () => {
    describe('success', () => {
      it('returns lessons ordered by creation order (oldest first)', async () => {
        const course = await createCourse({
          title: 'GET lessons e2e - ordering target course',
        });

        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B' },
        });
        const lesson3 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson C' },
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body).toHaveLength(3);
        expect(body.map((l) => l.id)).toEqual([
          lesson1.id,
          lesson2.id,
          lesson3.id,
        ]);
      });

      it('returns 200 with an empty array for a course with no lessons', async () => {
        const course = await createCourse({
          title: 'GET lessons e2e - empty course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);

        expect(response.body).toEqual([]);
      });
    });

    describe('not found', () => {
      it('returns 404 for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/lessons')
          .set('x-user-id', adminId)
          .expect(404);
      });

      it('returns 404 for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'GET lessons e2e - soft-deleted course',
        });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .expect(401);
      });

      it('returns 403 for a non-admin user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', nonAdminId)
          .expect(403);
      });
    });
  });

  describe('GET /courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('returns 200 with the exact persisted lesson fields', async () => {
        const course = await createCourse({
          title: 'GET lesson by id e2e - target course',
        });
        const lesson = await prisma.lesson.create({
          data: {
            courseId: course.id,
            title: 'Lesson 1',
            description: 'Details',
          },
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body).toEqual({
          id: lesson.id,
          courseId: course.id,
          title: 'Lesson 1',
          description: 'Details',
          createdAt: lesson.createdAt.toISOString(),
          updatedAt: lesson.updatedAt.toISOString(),
        });
      });
    });

    describe('not found', () => {
      it('returns 404 ("Lesson not found") for a well-formed but non-existent lessonId under an existing course', async () => {
        const course = await createCourse({
          title: 'GET lesson by id e2e - lesson not found course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/nonexistent-lesson-id`)
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/lessons/nonexistent-lesson-id`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 (no cross-course leak) when the lessonId exists but belongs to a different course', async () => {
        const courseA = await createCourse({
          title: 'GET lesson by id e2e - course A',
        });
        const courseB = await createCourse({
          title: 'GET lesson by id e2e - course B',
        });
        const lessonInB = await prisma.lesson.create({
          data: { courseId: courseB.id, title: 'Lesson in course B' },
        });

        await request(app.getHttpServer())
          .get(`/courses/${courseA.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .expect(404);

        // Confirm it still resolves normally under its real course.
        await request(app.getHttpServer())
          .get(`/courses/${courseB.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .expect(200);
      });

      it('returns 404 ("Course not found") for a non-existent courseId regardless of lessonId', async () => {
        await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .expect(404);
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/%20%20/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('returns 400 for a whitespace-only lessonId', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/%20%20`)
          .set('x-user-id', adminId)
          .expect(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/${lesson.id}`)
          .expect(401);
      });

      it('returns 403 for a non-admin user', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', nonAdminId)
          .expect(403);
      });
    });
  });
});
