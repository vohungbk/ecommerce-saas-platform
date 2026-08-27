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

describe('InstructorLessonsController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let instructorAId: string;
  let instructorBId: string;
  let adminId: string;
  let userId: string;
  const createdCourseIds: string[] = [];

  const INSTRUCTOR_A_EMAIL = 'instructor-lessons-e2e-a@example.com';
  const INSTRUCTOR_B_EMAIL = 'instructor-lessons-e2e-b@example.com';
  const ADMIN_EMAIL = 'instructor-lessons-e2e-admin@example.com';
  const USER_EMAIL = 'instructor-lessons-e2e-user@example.com';

  const createOwnedCourse = async (
    ownerId: string,
    overrides: { title?: string } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Instructor lessons e2e - target course',
        status: 'PUBLISHED',
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
      // Lesson rows cascade-delete with their parent course (onDelete:
      // Cascade), so deleting the courses is sufficient cleanup.
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
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

  describe('POST /instructor/courses/:courseId/lessons', () => {
    describe('success', () => {
      it('creates a lesson under a course owned by the caller', async () => {
        const course = await createOwnedCourse(instructorAId);

        const response = await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', instructorAId)
          .send({ title: 'Lesson 1' })
          .expect(201);

        const body = response.body as LessonResponseBody;
        expect(body).toMatchObject({ courseId: course.id, title: 'Lesson 1' });

        const persisted = await prisma.lesson.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.courseId).toBe(course.id);
      });

      it('allows an ADMIN caller to create a lesson in a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .send({ title: 'Admin-created lesson' })
          .expect(201);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to create a lesson in instructor B's course, creating no row", async () => {
        const course = await createOwnedCourse(instructorBId);
        const beforeCount = await prisma.lesson.count({
          where: { courseId: course.id },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', instructorAId)
          .send({ title: 'Should not be created' })
          .expect(404);

        const afterCount = await prisma.lesson.count({
          where: { courseId: course.id },
        });
        expect(afterCount).toBe(beforeCount);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);

        const response = await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons`)
          .send({ title: 'Lesson 1' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body.statusCode).toBe(401);
      });

      it('returns 403 for a plain USER caller and creates no row', async () => {
        const course = await createOwnedCourse(instructorAId);
        const beforeCount = await prisma.lesson.count({
          where: { courseId: course.id },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', userId)
          .send({ title: 'Lesson 1' })
          .expect(403);

        const afterCount = await prisma.lesson.count({
          where: { courseId: course.id },
        });
        expect(afterCount).toBe(beforeCount);
      });
    });
  });

  describe('GET /instructor/courses/:courseId/lessons', () => {
    describe('success', () => {
      it('lists lessons for a course owned by the caller', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B' },
        });

        const response = await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body.map((l) => l.id)).toEqual([lesson1.id, lesson2.id]);
      });

      it('allows an ADMIN caller to list lessons in a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId);
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', adminId)
          .expect(200);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to list instructor B's course lessons", async () => {
        const course = await createOwnedCourse(instructorBId);
        await prisma.lesson.create({
          data: { courseId: course.id, title: "B's lesson" },
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller', async () => {
        const course = await createOwnedCourse(instructorAId);

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons`)
          .set('x-user-id', userId)
          .expect(403);
      });
    });
  });

  describe('GET /instructor/courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('returns 200 with the lesson for a course owned by the caller', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });

        const response = await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body.id).toBe(lesson.id);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to view a lesson in instructor B's course", async () => {
        const course = await createOwnedCourse(instructorBId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: "B's lesson" },
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .expect(404);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A' },
        });

        await request(app.getHttpServer())
          .get(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', userId)
          .expect(403);
      });
    });
  });

  describe('PATCH /instructor/courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('updates a lesson in a course owned by the caller and persists the change', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        const response = await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .send({ title: 'New title' })
          .expect(200);

        const body = response.body as LessonResponseBody;
        expect(body.title).toBe('New title');

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('New title');
      });

      it('allows an ADMIN caller to update a lesson in a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .send({ title: 'Updated by admin' })
          .expect(200);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to update a lesson in instructor B's course, leaving it unchanged", async () => {
        const course = await createOwnedCourse(instructorBId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .send({ title: 'Should not apply' })
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .send({ title: 'New title' })
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves the row unchanged', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Original title' },
        });

        await request(app.getHttpServer())
          .patch(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', userId)
          .send({ title: 'Should not apply' })
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.title).toBe('Original title');
      });
    });
  });

  describe('DELETE /instructor/courses/:courseId/lessons/:lessonId', () => {
    describe('success', () => {
      it('deletes a lesson in a course owned by the caller', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson to delete' },
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .expect(200);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).toBeNull();
      });

      it('allows an ADMIN caller to delete a lesson in a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson to delete' },
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', adminId)
          .expect(200);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to delete a lesson in instructor B's course, leaving it intact", async () => {
        const course = await createOwnedCourse(instructorBId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: "B's lesson" },
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', instructorAId)
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves the row intact', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });

        await request(app.getHttpServer())
          .delete(`/instructor/courses/${course.id}/lessons/${lesson.id}`)
          .set('x-user-id', userId)
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted).not.toBeNull();
      });
    });
  });

  describe('POST /instructor/courses/:courseId/lessons/reorder', () => {
    describe('success', () => {
      it('reorders lessons in a course owned by the caller', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lessonA = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });
        const lessonB = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson B', position: 2 },
        });

        const response = await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', instructorAId)
          .send({
            lessons: [
              { id: lessonA.id, position: 2 },
              { id: lessonB.id, position: 1 },
            ],
          })
          .expect(200);

        const body = response.body as LessonResponseBody[];
        expect(body.map((l) => l.id)).toEqual([lessonB.id, lessonA.id]);
      });

      it('allows an ADMIN caller to reorder lessons in a course owned by any instructor (bypass)', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', adminId)
          .send({ lessons: [{ id: lesson.id, position: 1 }] })
          .expect(200);
      });
    });

    describe('cross-owner rejection', () => {
      it("rejects instructor A's attempt to reorder instructor B's course lessons, leaving positions unchanged", async () => {
        const course = await createOwnedCourse(instructorBId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: "B's lesson", position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', instructorAId)
          .send({ lessons: [{ id: lesson.id, position: 2 }] })
          .expect(404);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.position).toBe(1);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons/reorder`)
          .send({ lessons: [{ id: lesson.id, position: 1 }] })
          .expect(401);
      });

      it('returns 403 for a plain USER caller and leaves positions unchanged', async () => {
        const course = await createOwnedCourse(instructorAId);
        const lesson = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson A', position: 1 },
        });

        await request(app.getHttpServer())
          .post(`/instructor/courses/${course.id}/lessons/reorder`)
          .set('x-user-id', userId)
          .send({ lessons: [{ id: lesson.id, position: 2 }] })
          .expect(403);

        const persisted = await prisma.lesson.findUnique({
          where: { id: lesson.id },
        });
        expect(persisted?.position).toBe(1);
      });
    });
  });
});
