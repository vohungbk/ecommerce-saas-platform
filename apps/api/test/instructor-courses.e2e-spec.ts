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
  categoryId: string | null;
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

describe('InstructorCoursesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let instructorAId: string;
  let instructorBId: string;
  let adminId: string;
  let userId: string;
  const createdCourseIds: string[] = [];
  const createdCategoryIds: string[] = [];

  const INSTRUCTOR_A_EMAIL = 'instructor-courses-e2e-a@example.com';
  const INSTRUCTOR_B_EMAIL = 'instructor-courses-e2e-b@example.com';
  const ADMIN_EMAIL = 'instructor-courses-e2e-admin@example.com';
  const USER_EMAIL = 'instructor-courses-e2e-user@example.com';

  const createOwnedCourse = async (
    ownerId: string,
    overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Instructor courses e2e - target course',
        status: overrides.status ?? 'DRAFT',
        instructorId: ownerId,
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

    const instructorA = await prisma.user.upsert({
      where: { email: INSTRUCTOR_A_EMAIL },
      update: { role: 'INSTRUCTOR' },
      create: { email: INSTRUCTOR_A_EMAIL, role: 'INSTRUCTOR' },
    });
    instructorAId = instructorA.id;

    const instructorB = await prisma.user.upsert({
      where: { email: INSTRUCTOR_B_EMAIL },
      update: { role: 'INSTRUCTOR' },
      create: { email: INSTRUCTOR_B_EMAIL, role: 'INSTRUCTOR' },
    });
    instructorBId = instructorB.id;

    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: { role: 'ADMIN' },
      create: { email: ADMIN_EMAIL, role: 'ADMIN' },
    });
    adminId = admin.id;

    const user = await prisma.user.upsert({
      where: { email: USER_EMAIL },
      update: { role: 'USER' },
      create: { email: USER_EMAIL, role: 'USER' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (createdCourseIds.length > 0) {
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    if (createdCategoryIds.length > 0) {
      await prisma.category.deleteMany({
        where: { id: { in: createdCategoryIds } },
      });
    }
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [INSTRUCTOR_A_EMAIL, INSTRUCTOR_B_EMAIL, ADMIN_EMAIL, USER_EMAIL],
        },
      },
    });
    await app.close();
  });

  describe('POST /instructor/courses', () => {
    describe('success', () => {
      it('creates a course owned by the caller, status DRAFT, instructorId === caller id', async () => {
        const response = await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', instructorAId)
          .send({ title: 'Intro to TypeScript' })
          .expect(201);

        const body = response.body as CourseResponseBody;
        createdCourseIds.push(body.id);

        expect(body).toMatchObject({
          title: 'Intro to TypeScript',
          status: 'DRAFT',
          instructorId: instructorAId,
        });

        const persisted = await prisma.course.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.instructorId).toBe(instructorAId);
        expect(persisted?.status).toBe('DRAFT');
      });

      it('allows an ADMIN caller to create an owned course too (instructorId === admin id)', async () => {
        const response = await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', adminId)
          .send({ title: 'Admin-created instructor course' })
          .expect(201);

        const body = response.body as CourseResponseBody;
        createdCourseIds.push(body.id);
        expect(body.instructorId).toBe(adminId);
      });
    });

    describe('validation failures', () => {
      it('rejects a title shorter than 3 characters', async () => {
        await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', instructorAId)
          .send({ title: 'ab' })
          .expect(400);
      });

      it('rejects an extraneous instructorId field (server-assigned only)', async () => {
        await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', instructorAId)
          .send({ title: 'Valid Title', instructorId: instructorBId })
          .expect(400);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .post('/instructor/courses')
          .send({ title: 'Intro to TypeScript' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/instructor/courses',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', 'nonexistent-user-id')
          .send({ title: 'Intro to TypeScript' })
          .expect(401);
      });

      it('returns 403 for a plain USER caller and does not create a Course row', async () => {
        const beforeCount = await prisma.course.count();

        await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', userId)
          .send({ title: 'Intro to TypeScript' })
          .expect(403);

        const afterCount = await prisma.course.count();
        expect(afterCount).toBe(beforeCount);
      });
    });

    describe('categoryId', () => {
      it('creates a course with a valid categoryId, persisted in the response and DB', async () => {
        const category = await prisma.category.create({
          data: { name: 'POST /instructor/courses categoryId e2e - valid' },
        });
        createdCategoryIds.push(category.id);

        const response = await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', instructorAId)
          .send({ title: 'Course with category', categoryId: category.id })
          .expect(201);

        const body = response.body as CourseResponseBody;
        createdCourseIds.push(body.id);

        expect(body.categoryId).toBe(category.id);

        const persisted = await prisma.course.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.categoryId).toBe(category.id);
      });

      it('returns 404 "Category not found" for a non-existent categoryId and creates no course', async () => {
        const beforeCount = await prisma.course.count();

        const response = await request(app.getHttpServer())
          .post('/instructor/courses')
          .set('x-user-id', instructorAId)
          .send({
            title: 'Course with bad category',
            categoryId: 'nonexistent-category-id',
          })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(404);

        const afterCount = await prisma.course.count();
        expect(afterCount).toBe(beforeCount);
      });
    });
  });

  describe('GET /instructor/courses', () => {
    let aCourse1: string;
    let aCourse2: string;
    let bCourse: string;
    let unownedAdminCourse: string;
    let sharedCategoryId: string;

    beforeAll(async () => {
      await prisma.course.deleteMany({
        where: { instructorId: { not: null } },
      });

      const sharedCategory = await prisma.category.create({
        data: { name: 'GET /instructor/courses categoryId e2e - shared' },
      });
      sharedCategoryId = sharedCategory.id;
      createdCategoryIds.push(sharedCategoryId);

      const a1 = await createOwnedCourse(instructorAId, {
        title: 'GET /instructor/courses - A course 1',
      });
      const a2 = await createOwnedCourse(instructorAId, {
        title: 'GET /instructor/courses - A course 2',
        status: 'PUBLISHED',
      });
      const b1 = await createOwnedCourse(instructorBId, {
        title: 'GET /instructor/courses - B course 1',
      });
      aCourse1 = a1.id;
      aCourse2 = a2.id;
      bCourse = b1.id;

      // Both a2 (instructor A) and b1 (instructor B) share the same category,
      // so the categoryId filter test below proves ownership scoping still
      // excludes B's course even though it matches the category.
      await prisma.course.update({
        where: { id: aCourse2 },
        data: { categoryId: sharedCategoryId },
      });
      await prisma.course.update({
        where: { id: bCourse },
        data: { categoryId: sharedCategoryId },
      });

      const unowned = await prisma.course.create({
        data: { title: 'GET /instructor/courses - admin unowned course' },
      });
      unownedAdminCourse = unowned.id;
      createdCourseIds.push(unownedAdminCourse);
    });

    describe('success', () => {
      it("returns only instructor A's own courses, never B's or unowned admin courses", async () => {
        const response = await request(app.getHttpServer())
          .get('/instructor/courses')
          .set('x-user-id', instructorAId)
          .query({ limit: 100 })
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        const ids = body.data.map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining([aCourse1, aCourse2]));
        expect(ids).not.toContain(bCourse);
        expect(ids).not.toContain(unownedAdminCourse);
        expect(body.data.every((c) => c.instructorId === instructorAId)).toBe(
          true,
        );
      });

      it("returns only instructor B's own courses", async () => {
        const response = await request(app.getHttpServer())
          .get('/instructor/courses')
          .set('x-user-id', instructorBId)
          .query({ limit: 100 })
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        const ids = body.data.map((c) => c.id);
        expect(ids).toEqual([bCourse]);
      });

      it("filters by status within the caller's own courses", async () => {
        const response = await request(app.getHttpServer())
          .get('/instructor/courses')
          .set('x-user-id', instructorAId)
          .query({ status: 'PUBLISHED', limit: 100 })
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data.map((c) => c.id)).toEqual([aCourse2]);
      });

      it("filters by categoryId, returning only the caller's own course even when another instructor's course shares the same category", async () => {
        const response = await request(app.getHttpServer())
          .get('/instructor/courses')
          .set('x-user-id', instructorAId)
          .query({ categoryId: sharedCategoryId, limit: 100 })
          .expect(200);

        const body = response.body as PaginatedCoursesResponseBody;
        expect(body.data.map((c) => c.id)).toEqual([aCourse2]);
        expect(body.data.every((c) => c.instructorId === instructorAId)).toBe(
          true,
        );
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        await request(app.getHttpServer())
          .get('/instructor/courses')
          .expect(401);
      });

      it('returns 403 for a plain USER caller', async () => {
        await request(app.getHttpServer())
          .get('/instructor/courses')
          .set('x-user-id', userId)
          .expect(403);
      });
    });
  });

  describe('GET /instructor/courses/:id', () => {
    describe('success', () => {
      it("returns 200 with the course's full record (including instructorId) for the owner", async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'GET /instructor/courses/:id - owner target',
        });

        const response = await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body).toEqual({
          id: course.id,
          title: course.title,
          description: course.description,
          status: course.status,
          instructorId: instructorAId,
          categoryId: null,
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
          deletedAt: null,
        });
      });

      it('allows an ADMIN caller to view a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'GET /instructor/courses/:id - admin bypass target',
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);
      });
    });

    describe('cross-owner rejection', () => {
      it("returns a 4xx rejection when instructor A views instructor B's course, and leaves B's row unchanged (404 per D2)", async () => {
        const course = await createOwnedCourse(instructorBId, {
          title: "GET /instructor/courses/:id - B's course",
        });
        const before = await prisma.course.findUnique({
          where: { id: course.id },
        });

        const response = await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(404);

        const after = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(after).toEqual(before);
      });
    });

    describe('not found', () => {
      it('returns 404 for a course that neither exists nor is owned by the caller', async () => {
        await request(app.getHttpServer())
          .get('/instructor/courses/nonexistent-course-id')
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .set('x-user-id', userId)
          .expect(403);
      });
    });
  });

  describe('PATCH /instructor/courses/:id', () => {
    describe('success', () => {
      it('updates a course owned by the caller and persists the change', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'PATCH /instructor/courses/:id - original title',
        });

        const response = await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .send({ title: 'Updated Title' })
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.title).toBe('Updated Title');

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.title).toBe('Updated Title');
      });

      it('allows an ADMIN caller to update a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'PATCH /instructor/courses/:id - admin bypass target',
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Updated By Admin' })
          .expect(200);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.title).toBe('Updated By Admin');
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to update instructor B's course and leaves it byte-for-byte unchanged", async () => {
        const course = await createOwnedCourse(instructorBId, {
          title: "PATCH /instructor/courses/:id - B's course",
        });
        const before = await prisma.course.findUnique({
          where: { id: course.id },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .send({ title: 'Should not apply' })
          .expect(404);

        const after = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(after).toEqual(before);
      });

      it("rejects instructor A's attempt to assign a categoryId to instructor B's course, leaving categoryId unchanged", async () => {
        const category = await prisma.category.create({
          data: {
            name: 'PATCH /instructor/courses categoryId e2e - cross-owner',
          },
        });
        createdCategoryIds.push(category.id);
        const course = await createOwnedCourse(instructorBId, {
          title: "PATCH /instructor/courses/:id - B's category target",
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .send({ categoryId: category.id })
          .expect(404);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.categoryId).toBeNull();
      });
    });

    describe('categoryId', () => {
      it('assigns a valid categoryId to a course owned by the caller', async () => {
        const category = await prisma.category.create({
          data: { name: 'PATCH /instructor/courses categoryId e2e - valid' },
        });
        createdCategoryIds.push(category.id);
        const course = await createOwnedCourse(instructorAId, {
          title: 'PATCH /instructor/courses categoryId e2e - assign',
        });

        const response = await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .send({ categoryId: category.id })
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.categoryId).toBe(category.id);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.categoryId).toBe(category.id);
      });

      it('returns 404 "Category not found" for a non-existent categoryId and leaves the course unchanged', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'PATCH /instructor/courses categoryId e2e - bad category',
        });

        const response = await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .send({ categoryId: 'nonexistent-category-id' })
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(404);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.categoryId).toBeNull();
      });
    });

    describe('not found', () => {
      it('returns 404 for a course that neither exists nor is owned by the caller', async () => {
        await request(app.getHttpServer())
          .patch('/instructor/courses/nonexistent-course-id')
          .set('x-user-id', instructorAId)
          .send({ title: 'Valid Title' })
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .send({ title: 'Valid Title' })
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves the row unchanged', async () => {
        const course = await createOwnedCourse(instructorAId);
        const before = await prisma.course.findUnique({
          where: { id: course.id },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}`)
          .set('x-user-id', userId)
          .send({ title: 'Should not apply' })
          .expect(403);

        const after = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(after).toEqual(before);
      });
    });
  });

  describe('DELETE /instructor/courses/:id', () => {
    describe('success', () => {
      it('soft-deletes a course owned by the caller: 200 with deletedAt populated, subsequent GET 404', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'DELETE /instructor/courses/:id - target',
        });

        const response = await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.deletedAt).toEqual(expect.any(String));

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).not.toBeNull();

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .expect(404);
      });

      it('allows an ADMIN caller to delete a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId, {
          title: 'DELETE /instructor/courses/:id - admin bypass target',
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}`)
          .set('x-user-id', adminId)
          .expect(200);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).not.toBeNull();
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to delete instructor B's course and leaves it unchanged", async () => {
        const course = await createOwnedCourse(instructorBId, {
          title: "DELETE /instructor/courses/:id - B's course",
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}`)
          .set('x-user-id', instructorAId)
          .expect(404);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).toBeNull();
      });
    });

    describe('not found', () => {
      it('returns 404 for a course that neither exists nor is owned by the caller', async () => {
        await request(app.getHttpServer())
          .delete('/instructor/courses/nonexistent-course-id')
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves the row unchanged', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}`)
          .set('x-user-id', userId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.deletedAt).toBeNull();
      });
    });
  });

  describe('POST /instructor/courses/:id/publish', () => {
    describe('success', () => {
      it('publishes a DRAFT course owned by the caller: 200, status PUBLISHED, persisted', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'DRAFT',
        });

        const response = await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.status).toBe('PUBLISHED');

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });

      it('allows an ADMIN caller to publish a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .set('x-user-id', adminId)
          .expect(200);
      });
    });

    describe('conflict', () => {
      it('returns 409 when the course is already PUBLISHED, status unchanged', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .set('x-user-id', instructorAId)
          .expect(409);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to publish instructor B's course and leaves its status unchanged", async () => {
        const course = await createOwnedCourse(instructorBId, {
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .set('x-user-id', instructorAId)
          .expect(404);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });

    describe('not found', () => {
      it('returns 404 for a course that neither exists nor is owned by the caller', async () => {
        await request(app.getHttpServer())
          .post('/instructor/courses/nonexistent-course-id/publish')
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves status unchanged', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/publish`)
          .set('x-user-id', userId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });
  });

  describe('POST /instructor/courses/:id/unpublish', () => {
    describe('success', () => {
      it('unpublishes a PUBLISHED course owned by the caller: 200, status DRAFT, persisted', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'PUBLISHED',
        });

        const response = await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as CourseResponseBody;
        expect(body.status).toBe('DRAFT');

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });

      it('allows an ADMIN caller to unpublish a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .set('x-user-id', adminId)
          .expect(200);
      });
    });

    describe('conflict', () => {
      it('returns 409 when the course is already DRAFT, status unchanged', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'DRAFT',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .set('x-user-id', instructorAId)
          .expect(409);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('DRAFT');
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to unpublish instructor B's course and leaves its status unchanged", async () => {
        const course = await createOwnedCourse(instructorBId, {
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .set('x-user-id', instructorAId)
          .expect(404);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });

    describe('not found', () => {
      it('returns 404 for a course that neither exists nor is owned by the caller', async () => {
        await request(app.getHttpServer())
          .post('/instructor/courses/nonexistent-course-id/unpublish')
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves status unchanged', async () => {
        const course = await createOwnedCourse(instructorAId, {
          status: 'PUBLISHED',
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/unpublish`)
          .set('x-user-id', userId)
          .expect(403);

        const persisted = await prisma.course.findUnique({
          where: { id: course.id },
        });
        expect(persisted?.status).toBe('PUBLISHED');
      });
    });
  });
});
