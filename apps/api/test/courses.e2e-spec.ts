import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface CourseResponseBody {
  id: string;
  title: string;
  description: string | null;
  status: string;
  instructorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

interface PaginatedCoursesResponseBody {
  data: CourseResponseBody[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

describe('CoursesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminId: string;
  let nonAdminId: string;
  const createdCourseIds: string[] = [];

  const ADMIN_EMAIL = 'courses-e2e-admin@example.com';
  const NON_ADMIN_EMAIL = 'courses-e2e-user@example.com';

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
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN_EMAIL, NON_ADMIN_EMAIL] } },
    });
    await app.close();
  });

  describe('success', () => {
    it('creates a course with just a title and defaults status to DRAFT', async () => {
      const response = await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'Intro to TypeScript' })
        .expect(201);

      const body = response.body as CourseResponseBody;
      createdCourseIds.push(body.id);

      expect(body).toMatchObject({
        title: 'Intro to TypeScript',
        status: 'DRAFT',
      });
      expect(body.id).toEqual(expect.any(String));
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
      expect(body.description).toBeNull();
      expect(body.deletedAt).toBeNull();

      const persisted = await prisma.course.findUnique({
        where: { id: body.id },
      });
      expect(persisted?.status).toBe('DRAFT');
    });

    it('accepts a title exactly 3 characters long (lower boundary)', async () => {
      const response = await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'abc' })
        .expect(201);

      const body = response.body as CourseResponseBody;
      createdCourseIds.push(body.id);

      expect(body.title).toBe('abc');
      expect(body.status).toBe('DRAFT');
      expect(body.deletedAt).toBeNull();
    });

    it('accepts a title exactly 200 characters long (upper boundary)', async () => {
      const title = 'a'.repeat(200);
      const response = await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title })
        .expect(201);

      const body = response.body as CourseResponseBody;
      createdCourseIds.push(body.id);

      expect(body.title).toBe(title);
      expect(body.status).toBe('DRAFT');
      expect(body.deletedAt).toBeNull();
    });

    it('persists the supplied description', async () => {
      const response = await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'Intro to TS', description: 'A beginner course' })
        .expect(201);

      const body = response.body as CourseResponseBody;
      createdCourseIds.push(body.id);

      expect(body.description).toBe('A beginner course');
      expect(body.deletedAt).toBeNull();
    });
  });

  describe('validation failures', () => {
    it('rejects a title shorter than 3 characters', async () => {
      const response = await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'ab' })
        .expect(400);

      const body = response.body as ErrorResponseBody;
      expect(body.statusCode).toBe(400);
      const message = Array.isArray(body.message)
        ? body.message.join(' ')
        : body.message;
      expect(message).toContain('title');
      expect(message.toLowerCase()).toContain('longer than or equal to 3');
    });

    it('rejects a title longer than 200 characters', async () => {
      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'a'.repeat(201) })
        .expect(400);
    });

    it('rejects a missing title', async () => {
      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({})
        .expect(400);
    });

    it('rejects a whitespace-only title', async () => {
      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: '   ' })
        .expect(400);
    });

    it('rejects an extraneous status field', async () => {
      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', adminId)
        .send({ title: 'Valid Title', status: 'PUBLISHED' })
        .expect(400);
    });
  });

  describe('authn/authz failures', () => {
    it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/courses')
        .send({ title: 'Intro to TypeScript' })
        .expect(401);

      const body = response.body as ErrorResponseBody;
      expect(body).toMatchObject({
        statusCode: 401,
        error: expect.any(String) as string,
        message: expect.any(String) as string,
        path: '/courses',
        timestamp: expect.any(String) as string,
      });
    });

    it('returns 401 when the x-user-id header does not match an existing user', async () => {
      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', 'nonexistent-user-id')
        .send({ title: 'Intro to TypeScript' })
        .expect(401);
    });

    it('returns 403 for a non-admin user and does not create a Course row', async () => {
      const beforeCount = await prisma.course.count();

      await request(app.getHttpServer())
        .post('/courses')
        .set('x-user-id', nonAdminId)
        .send({ title: 'Intro to TypeScript' })
        .expect(403);

      const afterCount = await prisma.course.count();
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe('GET /courses', () => {
    let publishedId1: string;
    let publishedId2: string;
    let draftId1: string;

    beforeAll(async () => {
      // This spec file is the sole owner of the Course table in the test
      // DB (app.e2e-spec.ts never touches it), so it's safe to reset it to
      // a known, deterministic set of fixtures for the list endpoint tests.
      await prisma.course.deleteMany({});

      const published1 = await prisma.course.create({
        data: { title: 'GET /courses e2e - published 1', status: 'PUBLISHED' },
      });
      const published2 = await prisma.course.create({
        data: { title: 'GET /courses e2e - published 2', status: 'PUBLISHED' },
      });
      const draft1 = await prisma.course.create({
        data: { title: 'GET /courses e2e - draft 1', status: 'DRAFT' },
      });

      publishedId1 = published1.id;
      publishedId2 = published2.id;
      draftId1 = draft1.id;
    });

    afterAll(async () => {
      // Safety-net cleanup: runs unconditionally, independent of whether the
      // "empty results" test (which deletes these same fixtures as part of
      // its own setup) ran or passed. deleteMany with already-deleted ids is
      // a no-op, so this is idempotent regardless of execution order.
      await prisma.course.deleteMany({
        where: { id: { in: [publishedId1, publishedId2, draftId1] } },
      });
    });

    describe('success', () => {
      it('returns a paginated list with default page/limit and all seeded courses', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toHaveLength(3);
        expect(body.meta).toEqual({
          page: 1,
          limit: 10,
          total: 3,
          totalPages: 1,
        });
      });

      it('filters by status=PUBLISHED', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .query({ status: 'PUBLISHED' })
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toHaveLength(2);
        expect(body.data.every((c) => c.status === 'PUBLISHED')).toBe(true);
        expect(body.data.map((c) => c.id).sort()).toEqual(
          [publishedId1, publishedId2].sort(),
        );
        expect(body.meta.total).toBe(2);
      });

      it('filters by status=DRAFT', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .query({ status: 'DRAFT' })
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toHaveLength(1);
        expect(body.data[0].id).toBe(draftId1);
        expect(body.data[0].status).toBe('DRAFT');
        expect(body.meta.total).toBe(1);
      });

      it('paginates with page and limit', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .query({ page: 2, limit: 1 })
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toHaveLength(1);
        expect(body.meta).toMatchObject({
          page: 2,
          limit: 1,
          total: 3,
          totalPages: 3,
        });
      });

      it('returns an empty data array (not an error) when the page is beyond the last page', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .query({ page: 999, limit: 10 })
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(3);
      });
    });

    describe('validation failures', () => {
      it('rejects an invalid status value', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .query({ status: 'NOT_A_STATUS' })
          .set('x-user-id', adminId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
        const message = Array.isArray(body.message)
          ? body.message.join(' ')
          : body.message;
        expect(message).toContain('status');
      });

      it('rejects page=0', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ page: 0 })
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('rejects a negative page', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ page: -1 })
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('rejects limit=0', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ limit: 0 })
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('rejects a limit above the cap of 100', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ limit: 1000 })
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('rejects a non-numeric page', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ page: 'abc' })
          .set('x-user-id', adminId)
          .expect(400);
      });

      it('rejects an unknown query param', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .query({ unknownParam: 'value' })
          .set('x-user-id', adminId)
          .expect(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses')
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });

      it('returns 403 for a non-admin user', async () => {
        await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', nonAdminId)
          .expect(403);
      });
    });

    describe('empty results', () => {
      it('returns 200 with data: [] and meta.total 0 when no courses match at all', async () => {
        await prisma.course.deleteMany({
          where: { id: { in: [publishedId1, publishedId2, draftId1] } },
        });

        const response = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
        expect(body.meta.totalPages).toBe(0);
      });
    });
  });

  describe('GET /courses/:id', () => {
    let courseId: string;

    beforeAll(async () => {
      const course = await prisma.course.create({
        data: {
          title: 'GET /courses/:id e2e - target course',
          status: 'PUBLISHED',
        },
      });
      courseId = course.id;
      createdCourseIds.push(courseId);
    });

    afterAll(async () => {
      await prisma.course.deleteMany({ where: { id: courseId } });
    });

    describe('success', () => {
      it('returns 200 with the exact persisted course fields for an existing id', async () => {
        const response = await request(app.getHttpServer())
          .get(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(Object.keys(body).sort()).toEqual(
          [
            'id',
            'title',
            'description',
            'status',
            'instructorId',
            'createdAt',
            'updatedAt',
            'deletedAt',
          ].sort(),
        );

        const persisted = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(body).toEqual({
          id: persisted?.id,
          title: persisted?.title,
          description: persisted?.description ?? null,
          status: persisted?.status,
          instructorId: persisted?.instructorId ?? null,
          createdAt: persisted?.createdAt.toISOString(),
          updatedAt: persisted?.updatedAt.toISOString(),
          deletedAt: persisted?.deletedAt ?? null,
        });
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent id', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id')
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id',
          timestamp: expect.any(String) as string,
        });
      });
    });

    describe('validation failures', () => {
      it('returns 400 with the standard error shape for a whitespace-only id', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses/%20%20')
          .set('x-user-id', adminId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .get(`/courses/${courseId}`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${courseId}`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .get(`/courses/${courseId}`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });

      it('returns 403 for a non-admin user even when the course exists', async () => {
        await request(app.getHttpServer())
          .get(`/courses/${courseId}`)
          .set('x-user-id', nonAdminId)
          .expect(403);
      });
    });
  });

  describe('PATCH /courses/:id', () => {
    let courseId: string;

    beforeAll(async () => {
      const course = await prisma.course.create({
        data: {
          title: 'PATCH /courses/:id e2e - target course',
          description: 'Original description',
          status: 'PUBLISHED',
        },
      });
      courseId = course.id;
      createdCourseIds.push(courseId);
    });

    afterAll(async () => {
      await prisma.course.deleteMany({ where: { id: courseId } });
    });

    describe('success', () => {
      it('updates title only, leaves description unchanged, and persists the change', async () => {
        const before = await prisma.course.findUnique({
          where: { id: courseId },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ title: 'Updated Title' })
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body).toMatchObject({
          id: courseId,
          title: 'Updated Title',
          description: 'Original description',
          status: 'PUBLISHED',
        });

        const persisted = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(persisted?.title).toBe('Updated Title');
        expect(persisted?.description).toBe('Original description');
        expect(persisted?.updatedAt.getTime()).toBeGreaterThan(
          before?.updatedAt.getTime() ?? 0,
        );
      });

      it('updates description only, leaves title unchanged', async () => {
        const before = await prisma.course.findUnique({
          where: { id: courseId },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ description: 'A new description' })
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.title).toBe(before?.title);
        expect(body.description).toBe('A new description');

        const persisted = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(persisted?.title).toBe(before?.title);
        expect(persisted?.description).toBe('A new description');
      });
    });

    describe('validation failures', () => {
      it('rejects a title shorter than 3 characters', async () => {
        const before = await prisma.course.findUnique({
          where: { id: courseId },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ title: 'ab' })
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 400,
          error: expect.any(String) as string,
          path: `/courses/${courseId}`,
          timestamp: expect.any(String) as string,
        });
        expect(
          typeof body.message === 'string' || Array.isArray(body.message),
        ).toBe(true);

        const after = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(after).toEqual(before);
      });

      it('rejects a title longer than 200 characters', async () => {
        await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ title: 'a'.repeat(201) })
          .expect(400);
      });

      it('rejects a whitespace-only title', async () => {
        await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ title: '   ' })
          .expect(400);
      });

      it('rejects an extraneous status field and leaves status unchanged', async () => {
        const before = await prisma.course.findUnique({
          where: { id: courseId },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', adminId)
          .send({ status: 'DRAFT' })
          .expect(400);

        const after = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(after?.status).toBe(before?.status);
      });

      it('returns 400 with the standard error shape for a whitespace-only id', async () => {
        const response = await request(app.getHttpServer())
          .patch('/courses/%20%20')
          .set('x-user-id', adminId)
          .send({ title: 'Valid Title' })
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent id', async () => {
        const response = await request(app.getHttpServer())
          .patch('/courses/nonexistent-course-id')
          .set('x-user-id', adminId)
          .send({ title: 'Valid Title' })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 with the standard error shape when patching a soft-deleted course', async () => {
        const course = await prisma.course.create({
          data: {
            title: 'PATCH /courses/:id e2e - soft-deleted target',
            status: 'PUBLISHED',
          },
        });
        createdCourseIds.push(course.id);
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        const response = await request(app.getHttpServer())
          .patch(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Valid Title' })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}`,
          timestamp: expect.any(String) as string,
        });
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .send({ title: 'Valid Title' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${courseId}`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', 'nonexistent-user-id')
          .send({ title: 'Valid Title' })
          .expect(401);
      });

      it('returns 403 for a non-admin user and does not change the course row', async () => {
        const before = await prisma.course.findUnique({
          where: { id: courseId },
        });

        await request(app.getHttpServer())
          .patch(`/courses/${courseId}`)
          .set('x-user-id', nonAdminId)
          .send({ title: 'Should Not Apply' })
          .expect(403);

        const after = await prisma.course.findUnique({
          where: { id: courseId },
        });
        expect(after).toEqual(before);
      });
    });
  });

  describe('DELETE /courses/:id', () => {
    const createCourse = async (
      overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
    ) => {
      const course = await prisma.course.create({
        data: {
          title: overrides.title ?? 'DELETE /courses/:id e2e - target course',
          status: overrides.status ?? 'PUBLISHED',
        },
      });
      createdCourseIds.push(course.id);
      return course;
    };

    describe('success', () => {
      it('soft-deletes an existing course: returns 200 with deletedAt populated, and a subsequent GET on the same id returns 404', async () => {
        const course = await createCourse({ title: 'To be deleted' });

        const response = await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body).toMatchObject({
          id: course.id,
          title: 'To be deleted',
          status: 'PUBLISHED',
        });
        expect(body.deletedAt).toEqual(expect.any(String));

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).not.toBeNull();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(404);
      });
    });

    describe('not found / already deleted', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent id', async () => {
        const response = await request(app.getHttpServer())
          .delete('/courses/nonexistent-course-id')
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 when deleting a course that has already been soft-deleted', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(404);
      });
    });

    describe('validation failures', () => {
      it('returns 400 with the standard error shape for a whitespace-only id', async () => {
        const response = await request(app.getHttpServer())
          .delete('/courses/%20%20')
          .set('x-user-id', adminId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });

      it('returns 403 for a non-admin user and leaves the course row unchanged', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', nonAdminId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).toBeNull();
      });
    });

    describe('read-path exclusion', () => {
      it('excludes a soft-deleted course from GET /courses and GET /courses/:id, and from meta.total/totalPages', async () => {
        const course = await createCourse({
          title: 'DELETE /courses/:id e2e - exclusion target',
        });

        const before = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .query({ limit: 100 })
          .expect(200);
        const beforeBody = before.body as PaginatedCoursesResponseBody;
        const beforeTotal = beforeBody.meta.total;

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        await request(app.getHttpServer())
          .get(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(404);

        const after = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .query({ limit: 100 })
          .expect(200);
        const afterBody = after.body as PaginatedCoursesResponseBody;
        expect(afterBody.data.some((c) => c.id === course.id)).toBe(false);
        expect(afterBody.meta.total).toBe(beforeTotal - 1);
        expect(afterBody.meta.totalPages).toBe(
          Math.ceil((beforeTotal - 1) / 100),
        );
      });

      it('excludes a soft-deleted course from GET /courses?status=<status> filtered results', async () => {
        const course = await createCourse({
          title: 'DELETE /courses/:id e2e - status filter exclusion target',
          status: 'PUBLISHED',
        });

        const before = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .query({ status: 'PUBLISHED', limit: 100 })
          .expect(200);
        const beforeBody = before.body as PaginatedCoursesResponseBody;
        expect(beforeBody.data.some((c) => c.id === course.id)).toBe(true);

        await request(app.getHttpServer())
          .delete(`/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const after = await request(app.getHttpServer())
          .get('/courses')
          .set('x-user-id', adminId)
          .query({ status: 'PUBLISHED', limit: 100 })
          .expect(200);
        const afterBody = after.body as PaginatedCoursesResponseBody;
        expect(afterBody.data.some((c) => c.id === course.id)).toBe(false);
        expect(afterBody.meta.total).toBe(beforeBody.meta.total - 1);
      });
    });
  });

  describe('POST /courses/:id/publish', () => {
    const createCourse = async (
      overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
    ) => {
      const course = await prisma.course.create({
        data: {
          title:
            overrides.title ?? 'POST /courses/:id/publish e2e - target course',
          status: overrides.status ?? 'DRAFT',
        },
      });
      createdCourseIds.push(course.id);
      return course;
    };

    describe('success', () => {
      it('publishes a DRAFT course: returns 200 with status PUBLISHED, persisted', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body).toMatchObject({
          id: course.id,
          status: 'PUBLISHED',
        });

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });

    describe('validation failures', () => {
      it('returns 400 with the standard error shape for a whitespace-only id', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/%20%20/publish')
          .set('x-user-id', adminId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('conflict', () => {
      it('returns 409 with the standard error shape when the course is already PUBLISHED, status unchanged', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .set('x-user-id', adminId)
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/publish`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent id', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/publish')
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/publish',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 with the standard error shape when publishing a soft-deleted course', async () => {
        const course = await createCourse({ status: 'DRAFT' });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/publish`,
          timestamp: expect.any(String) as string,
        });
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/publish`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });

      it('returns 403 for a non-admin user and leaves the course status unchanged', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/publish`)
          .set('x-user-id', nonAdminId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });
  });

  describe('POST /courses/:id/unpublish', () => {
    const createCourse = async (
      overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
    ) => {
      const course = await prisma.course.create({
        data: {
          title:
            overrides.title ??
            'POST /courses/:id/unpublish e2e - target course',
          status: overrides.status ?? 'PUBLISHED',
        },
      });
      createdCourseIds.push(course.id);
      return course;
    };

    describe('success', () => {
      it('unpublishes a PUBLISHED course: returns 200 with status DRAFT, persisted', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body).toMatchObject({
          id: course.id,
          status: 'DRAFT',
        });

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });

    describe('validation failures', () => {
      it('returns 400 with the standard error shape for a whitespace-only id', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/%20%20/unpublish')
          .set('x-user-id', adminId)
          .expect(400);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(400);
      });
    });

    describe('conflict', () => {
      it('returns 409 with the standard error shape when the course is already DRAFT, status unchanged', async () => {
        const course = await createCourse({ status: 'DRAFT' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .set('x-user-id', adminId)
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/unpublish`,
          timestamp: expect.any(String) as string,
        });

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });

    describe('not found', () => {
      it('returns 404 with the standard error shape for a well-formed but non-existent id', async () => {
        const response = await request(app.getHttpServer())
          .post('/courses/nonexistent-course-id/unpublish')
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/courses/nonexistent-course-id/unpublish',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 404 with the standard error shape when unpublishing a soft-deleted course', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .set('x-user-id', adminId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 404,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/unpublish`,
          timestamp: expect.any(String) as string,
        });
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        const response = await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/unpublish`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });

      it('returns 403 for a non-admin user and leaves the course status unchanged', async () => {
        const course = await createCourse({ status: 'PUBLISHED' });

        await request(app.getHttpServer())
          .post(`/courses/${course.id}/unpublish`)
          .set('x-user-id', nonAdminId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });
  });
});
