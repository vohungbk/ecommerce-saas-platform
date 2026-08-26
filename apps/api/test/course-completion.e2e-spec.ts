import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface CourseCompletionResponseBody {
  courseId: string;
  completed: boolean;
  completedAt: string | null;
}

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

describe('Course completion (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  let adminId: string;
  const createdCourseIds: string[] = [];

  const USER_A_EMAIL = 'completion-e2e-user-a@example.com';
  const USER_B_EMAIL = 'completion-e2e-user-b@example.com';
  const ADMIN_EMAIL = 'completion-e2e-admin@example.com';

  const createCourse = async (
    overrides: {
      title?: string;
      status?: 'DRAFT' | 'PUBLISHED';
      deletedAt?: Date;
    } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'Course completion e2e - target course',
        status: overrides.status ?? 'PUBLISHED',
        deletedAt: overrides.deletedAt,
      },
    });
    createdCourseIds.push(course.id);
    return course;
  };

  const enroll = (courseId: string, userId: string) =>
    prisma.enrollment.create({ data: { userId, courseId } });

  const markLesson = (
    courseId: string,
    lessonId: string,
    userId: string,
    completed: boolean,
  ) =>
    request(app.getHttpServer())
      .put(`/courses/${courseId}/lessons/${lessonId}/progress`)
      .set('x-user-id', userId)
      .send({ completed })
      .expect(200);

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
      // Lesson + Enrollment + LessonProgress + CourseCompletion rows
      // cascade-delete with their parent course (onDelete: Cascade), so
      // deleting the courses is sufficient cleanup.
      await prisma.course.deleteMany({
        where: { id: { in: createdCourseIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL, ADMIN_EMAIL] } },
    });
    await app.close();
  });

  describe('GET /courses/:courseId/completion', () => {
    describe('success', () => {
      it('returns completed: false, completedAt: null when 0 of N lessons are completed', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - not started course',
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          completed: false,
          completedAt: null,
        });

        const persisted = await prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId: userAId, courseId: course.id } },
        });
        expect(persisted).toBeNull();
      });

      it('returns completed: false, completedAt: null when M of N lessons are completed (0 < M < N)', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - partial course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          completed: false,
          completedAt: null,
        });
      });

      it('creates a CourseCompletion row and returns completed: true when the final lesson is completed', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - final lesson course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);
        const before = Date.now();
        await markLesson(course.id, lesson2.id, userAId, true);
        const after = Date.now();

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);

        const body = response.body as CourseCompletionResponseBody;
        expect(body.courseId).toBe(course.id);
        expect(body.completed).toBe(true);
        expect(body.completedAt).not.toBeNull();

        // Completion timestamp is a valid ISO-8601 timestamp close to "now".
        const completedAtMs = new Date(body.completedAt as string).getTime();
        expect(completedAtMs).toBeGreaterThanOrEqual(before - 1000);
        expect(completedAtMs).toBeLessThanOrEqual(after + 1000);

        const persisted = await prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId: userAId, courseId: course.id } },
        });
        expect(persisted).not.toBeNull();
      });

      it('returns the same completed: true and the same original completedAt on a repeat GET (already completed course)', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - already completed course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);

        const first = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const firstBody = first.body as CourseCompletionResponseBody;
        expect(firstBody.completed).toBe(true);

        const second = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const secondBody = second.body as CourseCompletionResponseBody;
        expect(secondBody.completed).toBe(true);
        expect(secondBody.completedAt).toBe(firstBody.completedAt);
      });

      it('never returns completed: true for a zero-lesson course', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - zero-lesson course',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          completed: false,
          completedAt: null,
        });

        const persisted = await prisma.courseCompletion.findUnique({
          where: { userId_courseId: { userId: userAId, courseId: course.id } },
        });
        expect(persisted).toBeNull();
      });

      it('completion survives un-completing a lesson afterward', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - un-complete after completion course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);
        const completedResponse = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const completedBody =
          completedResponse.body as CourseCompletionResponseBody;
        expect(completedBody.completed).toBe(true);

        await markLesson(course.id, lesson1.id, userAId, false);

        const afterUncomplete = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const afterBody = afterUncomplete.body as CourseCompletionResponseBody;
        expect(afterBody.completed).toBe(true);
        expect(afterBody.completedAt).toBe(completedBody.completedAt);
      });

      it('completion survives a new lesson being added afterward', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - lesson added after completion course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);
        const completedResponse = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const completedBody =
          completedResponse.body as CourseCompletionResponseBody;
        expect(completedBody.completed).toBe(true);

        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2 - added later' },
        });

        const afterLessonAdded = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const afterBody = afterLessonAdded.body as CourseCompletionResponseBody;
        expect(afterBody.completed).toBe(true);
        expect(afterBody.completedAt).toBe(completedBody.completedAt);
      });

      it('completion survives a lesson being removed afterward', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - lesson removed after completion course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);
        await markLesson(course.id, lesson2.id, userAId, true);
        const completedResponse = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const completedBody =
          completedResponse.body as CourseCompletionResponseBody;
        expect(completedBody.completed).toBe(true);

        await prisma.lesson.delete({ where: { id: lesson2.id } });

        const afterLessonRemoved = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(200);
        const afterBody =
          afterLessonRemoved.body as CourseCompletionResponseBody;
        expect(afterBody.completed).toBe(true);
        expect(afterBody.completedAt).toBe(completedBody.completedAt);
      });
    });

    describe('not found', () => {
      it('returns 404 ("Enrollment not found") when the caller is not enrolled', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - not enrolled course',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Enrollment'));
      });

      it('returns 404 ("Course not found") for a non-existent courseId', async () => {
        const response = await request(app.getHttpServer())
          .get('/courses/nonexistent-course-id/completion')
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Course'));
      });

      it('returns 404 ("Course not found") for a soft-deleted course, even if the caller is enrolled', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - soft-deleted course',
        });
        await enroll(course.id, userAId);
        await prisma.course.update({
          where: { id: course.id },
          data: { deletedAt: new Date() },
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userAId)
          .expect(404);

        const body = response.body as ErrorResponseBody;
        expect(body.message).toEqual(expect.stringContaining('Course'));
      });
    });

    describe('user isolation', () => {
      it("user B's completion status reflects only user B's own progress, not user A's", async () => {
        const course = await createCourse({
          title: 'GET completion e2e - isolation course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await enroll(course.id, userAId);
        await enroll(course.id, userBId);

        await markLesson(course.id, lesson1.id, userAId, true);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', userBId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          completed: false,
          completedAt: null,
        });
      });
    });

    describe('not published', () => {
      it('returns 403 when the caller is enrolled but the course is DRAFT', async () => {
        const course = await createCourse({
          title: 'GET completion e2e - unpublished course',
          status: 'DRAFT',
        });
        await enroll(course.id, userAId);

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
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
          title: 'GET completion e2e - admin bypass course',
          status: 'DRAFT',
        });

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', adminId)
          .expect(200);

        expect(response.body).toEqual({
          courseId: course.id,
          completed: false,
          completedAt: null,
        });
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const course = await createCourse();

        const response = await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: `/courses/${course.id}/completion`,
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        const course = await createCourse();

        await request(app.getHttpServer())
          .get(`/courses/${course.id}/completion`)
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });

    describe('validation failures', () => {
      it('returns 400 for a whitespace-only courseId', async () => {
        await request(app.getHttpServer())
          .get('/courses/%20%20/completion')
          .set('x-user-id', userAId)
          .expect(400);
      });
    });
  });

  describe('database constraint', () => {
    it('rejects a direct duplicate (userId, courseId) insert at the DB level with a P2002 error', async () => {
      const course = await createCourse({
        title: 'DB constraint e2e - duplicate completion course',
      });

      await prisma.courseCompletion.create({
        data: { userId: userAId, courseId: course.id },
      });

      const duplicateInsert = prisma.courseCompletion.create({
        data: { userId: userAId, courseId: course.id },
      });

      await expect(duplicateInsert).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError,
      );
      await expect(duplicateInsert).rejects.toMatchObject({ code: 'P2002' });
    });

    it('does not create a second CourseCompletion row when the final lesson is re-PUT after completion', async () => {
      const course = await createCourse({
        title: 'DB constraint e2e - re-PUT final lesson course',
      });
      const lesson1 = await prisma.lesson.create({
        data: { courseId: course.id, title: 'Lesson 1' },
      });
      await enroll(course.id, userAId);

      await markLesson(course.id, lesson1.id, userAId, true);
      await markLesson(course.id, lesson1.id, userAId, true);

      const count = await prisma.courseCompletion.count({
        where: { userId: userAId, courseId: course.id },
      });
      expect(count).toBe(1);
    });
  });
});
