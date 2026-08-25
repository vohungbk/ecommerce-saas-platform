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
  position: number;
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

      it('orders lessons by position, not by creation order, when positions are set out of creation order', async () => {
        const course = await createCourse({
          title: 'GET lessons e2e - position ordering course',
        });

        // Created in this order (A, B, C) but seeded with positions that
        // reverse that order, proving the response follows `position` and
        // not `createdAt`.
        const lessonA = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 3 },
        });
        const lessonB = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B', position: 1 },
        });
        const lessonC = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson C', position: 2 },
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body.map((l) => l.id)).toEqual([
          lessonB.id,
          lessonC.id,
          lessonA.id,
        ]);
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

  describe('POST /courses/:courseId/lessons/reorder', () => {
    describe('success', () => {
      it('reorders 3 lessons and reflects the new order on a follow-up GET', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - basic reorder course',
        });
        const lessonA = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });
        const lessonB = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B', position: 2 },
        });
        const lessonC = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson C', position: 3 },
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({
            lessons: [
              { id: lessonA.id, position: 3 },
              { id: lessonB.id, position: 1 },
              { id: lessonC.id, position: 2 },
            ],
          })
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body.map((l) => l.id)).toEqual([
          lessonB.id,
          lessonC.id,
          lessonA.id,
        ]);

        const getResponse = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);
        const getBody = getResponse.body as LessonResponseBody[];
        expect(getBody.map((l) => l.id)).toEqual([
          lessonB.id,
          lessonC.id,
          lessonA.id,
        ]);
      });

      it('applies every changed position atomically when reordering 4+ lessons at once', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - multiple lessons course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1', position: 1 },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2', position: 2 },
        });
        const lesson3 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 3', position: 3 },
        });
        const lesson4 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 4', position: 4 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({
            lessons: [
              { id: lesson1.id, position: 4 },
              { id: lesson2.id, position: 3 },
              { id: lesson3.id, position: 2 },
              { id: lesson4.id, position: 1 },
            ],
          })
          .expect(200);

        const getResponse = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);
        const getBody = getResponse.body as LessonResponseBody[];
        expect(getBody.map((l) => l.id)).toEqual([
          lesson4.id,
          lesson3.id,
          lesson2.id,
          lesson1.id,
        ]);
      });
    });

    describe('validation failures', () => {
      let courseId: string;
      let lessonId: string;

      beforeAll(async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - validation failures course',
        });
        courseId = course.id;
        const lesson = await prisma.lesson.create({
          data: { courseId, title: 'Lesson 1', position: 1 },
        });
        lessonId = lesson.id;
      });

      it('rejects an empty lessons array', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [] })
          .expect(400);
      });

      it('rejects a payload missing the lessons field entirely', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({})
          .expect(400);
      });

      it('rejects an item with a non-integer position', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: lessonId, position: 1.5 }] })
          .expect(400);
      });

      it('rejects an item with position < 1', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: lessonId, position: 0 }] })
          .expect(400);
      });

      it('rejects an item with a missing id', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ position: 1 }] })
          .expect(400);
      });

      it('rejects an item with an empty id', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: '', position: 1 }] })
          .expect(400);
      });

      it('rejects an item with an extraneous field', async () => {
        await request(app.getHttpServer())
          .post(`/courses/${courseId}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: lessonId, position: 1, courseId: 'x' }] })
          .expect(400);
      });

      it('rejects a payload with duplicate positions, and leaves lesson positions unchanged', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - duplicate positions course',
        });
        const lessonA = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });
        const lessonB = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B', position: 2 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({
            lessons: [
              { id: lessonA.id, position: 1 },
              { id: lessonB.id, position: 1 },
            ],
          })
          .expect(400);

        const persistedA = await prisma.lesson.findUnique({
          where: { id: lessonA.id },
        });
        const persistedB = await prisma.lesson.findUnique({
          where: { id: lessonB.id },
        });
        expect(persistedA?.position).toBe(1);
        expect(persistedB?.position).toBe(2);
      });

      it("rejects a payload that omits some of the course's lessons, and leaves lesson positions unchanged", async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - partial payload course',
        });
        const lessonA = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });
        const lessonB = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B', position: 2 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: lessonA.id, position: 2 }] })
          .expect(400);

        const persistedA = await prisma.lesson.findUnique({
          where: { id: lessonA.id },
        });
        const persistedB = await prisma.lesson.findUnique({
          where: { id: lessonB.id },
        });
        expect(persistedA?.position).toBe(1);
        expect(persistedB?.position).toBe(2);
      });
    });

    describe('not found', () => {
      it('returns 404 for a non-existent courseId', async () => {
        await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/lessons/reorder')
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: 'some-lesson-id', position: 1 }] })
          .expect(404);
      });

      it('returns 404 for a payload id that does not exist at all, and leaves existing lesson positions unchanged', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - unknown lesson id course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: 'nonexistent-lesson-id', position: 1 }] })
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.position).toBe(1);
      });

      it('returns 404 (no cross-course leak) when a payload id belongs to a different course, and leaves that lesson unmodified', async () => {
        const courseA = await createCourse({
          title: 'Reorder lessons e2e - course A',
        });
        const courseB = await createCourse({
          title: 'Reorder lessons e2e - course B',
        });
        const lessonInA = await prisma.lesson.create({
          data: {
            courseId: courseA.id,
            title: 'Lesson in course A',
            position: 1,
          },
        });
        const lessonInB = await prisma.lesson.create({
          data: {
            courseId: courseB.id,
            title: 'Lesson in course B',
            position: 1,
          },
        });

        await request(app.getHttpServer())
          .post(`/courses/${courseA.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({
            lessons: [
              { id: lessonInA.id, position: 1 },
              { id: lessonInB.id, position: 2 },
            ],
          })
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lessonInB.id },
        });
        expect(persisted?.courseId).toBe(courseB.id);
        expect(persisted?.position).toBe(1);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing, leaving positions unchanged', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - missing header course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .send({ lessons: [{ id: lesson.id, position: 1 }] })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/lessons/reorder`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.position).toBe(1);
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - unknown user course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ lessons: [{ id: lesson.id, position: 1 }] })
          .expect(401);
      });

      it('returns 403 for a non-admin user and leaves positions unchanged', async () => {
        const course = await createCourse({
          title: 'Reorder lessons e2e - non-admin course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', nonAdminId)
          .send({ lessons: [{ id: lesson.id, position: 1 }] })
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.position).toBe(1);
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
          position: 0,
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

  describe('PATCH /courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('updates title only, leaving description unchanged and refreshing updatedAt', async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - title only course',
        });
        const lesson = await prisma.lesson.create({
          data: {
            courseId: course.id,
            title: 'Original title',
            description: 'Original description',
          },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body).toMatchObject({
          id: lesson.id,
          courseId: course.id,
          title: 'New title',
          description: 'Original description',
        });
        expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(
          lesson.updatedAt.getTime(),
        );

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('New title');
        expect(persisted?.description).toBe('Original description');
      });

      it('updates description only, leaving title unchanged', async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - description only course',
        });
        const lesson = await prisma.lesson.create({
          data: {
            courseId: course.id,
            title: 'Original title',
            description: 'Original description',
          },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ description: 'New description' })
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body).toMatchObject({
          title: 'Original title',
          description: 'New description',
        });
      });

      it('updates both title and description when both are supplied', async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - both fields course',
        });
        const lesson = await prisma.lesson.create({
          data: {
            courseId: course.id,
            title: 'Original title',
            description: 'Original description',
          },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'New title', description: 'New description' })
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body).toMatchObject({
          title: 'New title',
          description: 'New description',
        });
      });
    });

    describe('validation failures', () => {
      let courseId: string;

      beforeAll(async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - validation failures course',
        });
        courseId = course.id;
      });

      const createLesson = () =>
        prisma.lesson.create({
          data: {
            courseId,
            title: 'Original title',
            description: 'Original description',
          },
        });

      it('rejects a title shorter than 3 characters, leaving the row unchanged', async () => {
        const lesson = await createLesson();

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'ab' })
          .expect(400);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });

      it('rejects a title longer than 200 characters, leaving the row unchanged', async () => {
        const lesson = await createLesson();

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'a'.repeat(201) })
          .expect(400);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });

      it('rejects a whitespace-only title, leaving the row unchanged', async () => {
        const lesson = await createLesson();

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: '   ' })
          .expect(400);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });

      it('rejects an extraneous field, leaving the row unchanged', async () => {
        const lesson = await createLesson();

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Valid title', order: 1 })
          .expect(400);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });

      it('rejects a client-supplied courseId in the body (cannot move a lesson to a different course), leaving the row unchanged', async () => {
        const otherCourse = await createCourse({
          title: 'PATCH lesson e2e - attempted move target course',
        });
        const lesson = await createLesson();

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Valid title', courseId: otherCourse.id })
          .expect(400);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
        expect(persisted?.courseId).toBe(courseId);
      });

      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .patch('/courses/%20%20/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(400);
      });

      it('returns 400 for a whitespace-only lessonId', async () => {
        await request(app.getHttpServer())
          .patch(`/courses/${courseId}/lessons/%20%20`)
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(400);
      });
    });

    describe('not found', () => {
      it('returns 404 ("Course not found") for a non-existent courseId regardless of lessonId', async () => {
        const response = await request(app.getHttpServer())
          .patch('/courses/nonexistent-course-id/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/lessons/some-lesson-id',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - soft-deleted course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(404);
      });

      it('returns 404 ("Lesson not found") for a well-formed but non-existent lessonId under an existing course', async () => {
        const course = await createCourse({
          title: 'PATCH lesson e2e - lesson not found course',
        });

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/nonexistent-lesson-id`)
          .set('x-user-id', adminId)
          .send({ title: 'New title' })
          .expect(404);
      });

      it('returns 404 (no cross-course leak) when the lessonId exists but belongs to a different course, and still succeeds under its real course', async () => {
        const courseA = await createCourse({
          title: 'PATCH lesson e2e - course A',
        });
        const courseB = await createCourse({
          title: 'PATCH lesson e2e - course B',
        });
        const lessonInB = await prisma.lesson.create({
          data: { courseId: courseB.id, title: 'Lesson in course B' },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${courseA.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Attempted update from course A' })
          .expect(404);

        const unchanged = await prisma.lesson.findUnique({
          where: { id: lessonInB.id },
        });
        expect(unchanged?.title).toBe('Lesson in course B');

        const response = await request(app.getHttpServer())
          .patch(`/courses/${courseB.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Updated via course B' })
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body.title).toBe('Updated via course B');
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .send({ title: 'New title' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/lessons/${lesson.id}`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ title: 'New title' })
          .expect(401);
      });

      it('returns 403 for a non-admin user and leaves the row unchanged', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', nonAdminId)
          .send({ title: 'New title' })
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });
    });
  });

  describe('DELETE /courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('deletes the lesson, returns its persisted fields, and removes the row', async () => {
        const course = await createCourse({
          title: 'DELETE lesson e2e - target course',
        });
        const lesson = await prisma.lesson.create({
          data: {
            courseId: course.id,
            title: 'Lesson to delete',
            description: 'Details',
          },
        });

        const response = await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body).toEqual({
          id: lesson.id,
          courseId: course.id,
          title: 'Lesson to delete',
          description: 'Details',
          position: 0,
          createdAt: lesson.createdAt.toISOString(),
          updatedAt: lesson.updatedAt.toISOString(),
        });

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).toBeNull();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .expect(404);
      });

      it('leaves sibling lessons unaffected when deleting one lesson', async () => {
        const course = await createCourse({
          title: 'DELETE lesson e2e - sibling isolation course',
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

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson2.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body).toEqual([
          {
            id: lesson1.id,
            courseId: course.id,
            title: lesson1.title,
            description: lesson1.description,
            position: lesson1.position,
            createdAt: lesson1.createdAt.toISOString(),
            updatedAt: lesson1.updatedAt.toISOString(),
          },
          {
            id: lesson3.id,
            courseId: course.id,
            title: lesson3.title,
            description: lesson3.description,
            position: lesson3.position,
            createdAt: lesson3.createdAt.toISOString(),
            updatedAt: lesson3.updatedAt.toISOString(),
          },
        ]);
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a non-existent courseId, and deletes no Lesson row', async () => {
        const beforeCount = await prisma.lesson.count();

        const response = await request(app.getHttpServer())
          .delete('/courses/nonexistent-course-id/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/lessons/some-lesson-id',
          timestamp: expect.any(String) as string,
        });

        const afterCount = await prisma.lesson.count();
        expect(afterCount).toBe(beforeCount);
      });

      it('returns 404 for a soft-deleted course', async () => {
        const course = await createCourse({
          title: 'DELETE lesson e2e - soft-deleted course',
        });
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });

      it('returns 404 ("Lesson not found") for a well-formed but non-existent lessonId under an existing course', async () => {
        const course = await createCourse({
          title: 'DELETE lesson e2e - lesson not found course',
        });

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/nonexistent-lesson-id`)
          .set('x-user-id', adminId)
          .expect(404);
      });

      it('returns 404 (no cross-course leak) when the lessonId exists but belongs to a different course, does not delete it, and still succeeds under its real course', async () => {
        const courseA = await createCourse({
          title: 'DELETE lesson e2e - course A',
        });
        const courseB = await createCourse({
          title: 'DELETE lesson e2e - course B',
        });
        const lessonInB = await prisma.lesson.create({
          data: { courseId: courseB.id, title: 'Lesson in course B' },
        });

        await request(app.getHttpServer())
          .delete(`/courses/${courseA.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .expect(404);

        const stillThere = await prisma.lesson.findUnique({
          where: { id: lessonInB.id },
        });
        expect(stillThere).not.toBeNull();
        expect(stillThere?.title).toBe('Lesson in course B');

        await request(app.getHttpServer())
          .delete(`/courses/${courseB.id}/lessons/${lessonInB.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const afterReal = await prisma.lesson.findUnique({
          where: { id: lessonInB.id },
        });
        expect(afterReal).toBeNull();
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .delete('/courses/%20%20/lessons/some-lesson-id')
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('returns 400 for a whitespace-only lessonId', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/%20%20`)
          .set('x-user-id', adminId)
          .expect(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing, leaving the row intact', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        const response = await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson.id}`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/lessons/${lesson.id}`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });

      it('returns 401 when the x-user-id header does not match an existing user, leaving the row intact', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });

      it('returns 403 for a non-admin user and leaves the row intact', async () => {
        const course = await createCourse();
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', nonAdminId)
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });
    });
  });
});
