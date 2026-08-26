import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface MyLearningItemResponseBody {
  course: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  };
  enrolledAt: string;
  totalLessons: number;
  completedLessons: number;
  remainingLessons: number;
  completionPercentage: number;
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

describe('My Learning (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  const createdCourseIds: string[] = [];

  const USER_A_EMAIL = 'my-learning-e2e-user-a@example.com';
  const USER_B_EMAIL = 'my-learning-e2e-user-b@example.com';

  const createCourse = async (
    overrides: { title?: string; status?: 'DRAFT' | 'PUBLISHED' } = {},
  ) => {
    const course = await prisma.course.create({
      data: {
        title: overrides.title ?? 'My Learning e2e - target course',
        status: overrides.status ?? 'PUBLISHED',
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

  const getMyLearning = (userId: string) =>
    request(app.getHttpServer()).get('/my-learning').set('x-user-id', userId);

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

  afterEach(async () => {
    // Each test scopes its own courses via createdCourseIds, but enrollments/
    // progress/completions cascade-delete with the course, so reset the two
    // shared users to a known-empty enrollment state between tests to avoid
    // cross-test bleed.
    await prisma.enrollment.deleteMany({
      where: { userId: { in: [userAId, userBId] } },
    });
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
      where: { email: { in: [USER_A_EMAIL, USER_B_EMAIL] } },
    });
    await app.close();
  });

  describe('GET /my-learning', () => {
    describe('success', () => {
      it('returns 200 with an empty array when the caller has no enrollments', async () => {
        const response = await getMyLearning(userAId).expect(200);

        expect(response.body).toEqual([]);
      });

      it('returns one item for a user enrolled in exactly one course with no lessons completed', async () => {
        const course = await createCourse({
          title: 'My Learning e2e - single course, no lessons completed',
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({
          totalLessons: 2,
          completedLessons: 0,
          remainingLessons: 2,
          completionPercentage: 0,
          completed: false,
          completedAt: null,
        });
        expect(body[0].course).toMatchObject({
          id: course.id,
          title: course.title,
          status: 'PUBLISHED',
        });
      });

      it('returns one item per enrolled course for a user enrolled in multiple courses, ordered by enrollment createdAt descending', async () => {
        const course1 = await createCourse({
          title: 'My Learning e2e - multi course 1',
        });
        const course2 = await createCourse({
          title: 'My Learning e2e - multi course 2',
        });
        const course3 = await createCourse({
          title: 'My Learning e2e - multi course 3',
        });

        await enroll(course1.id, userAId);
        await enroll(course2.id, userAId);
        await enroll(course3.id, userAId);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body).toHaveLength(3);
        expect(body.map((item) => item.course.id)).toEqual([
          course3.id,
          course2.id,
          course1.id,
        ]);
        expect(new Set(body.map((item) => item.course.id)).size).toBe(3);
      });

      it('returns completionPercentage: 0 and completed: false for a course with lessons but 0 completed', async () => {
        const course = await createCourse({
          title: 'My Learning e2e - 0 of N completed',
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body[0]).toMatchObject({
          completionPercentage: 0,
          remainingLessons: 2,
          completed: false,
        });
      });

      it('returns 0 < completionPercentage < 100 and completed: false for a partially completed course', async () => {
        const course = await createCourse({
          title: 'My Learning e2e - partially completed',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        await markLesson(course.id, lesson1.id, userAId, true);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body[0].completionPercentage).toBeGreaterThan(0);
        expect(body[0].completionPercentage).toBeLessThan(100);
        expect(body[0]).toMatchObject({
          totalLessons: 2,
          completedLessons: 1,
          remainingLessons: 1,
          completed: false,
          completedAt: null,
        });
      });

      it('returns completionPercentage: 100, completed: true, and a valid completedAt for a fully completed course', async () => {
        const course = await createCourse({
          title: 'My Learning e2e - fully completed',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 1' },
        });
        const lesson2 = await prisma.lesson.create({
          data: { courseId: course.id, title: 'Lesson 2' },
        });
        await enroll(course.id, userAId);

        const before = Date.now();
        await markLesson(course.id, lesson1.id, userAId, true);
        await markLesson(course.id, lesson2.id, userAId, true);
        const after = Date.now();

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body[0]).toMatchObject({
          totalLessons: 2,
          completedLessons: 2,
          remainingLessons: 0,
          completionPercentage: 100,
          completed: true,
        });
        expect(body[0].completedAt).not.toBeNull();
        const completedAtMs = new Date(body[0].completedAt as string).getTime();
        expect(completedAtMs).toBeGreaterThanOrEqual(before - 1000);
        expect(completedAtMs).toBeLessThanOrEqual(after + 1000);
      });

      it('keeps completedAt null for not-yet-completed courses and non-null only for courses with a persisted CourseCompletion row', async () => {
        const incompleteCourse = await createCourse({
          title: 'My Learning e2e - completedAt null course',
        });
        const lesson1 = await prisma.lesson.create({
          data: { courseId: incompleteCourse.id, title: 'Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: incompleteCourse.id, title: 'Lesson 2' },
        });
        await enroll(incompleteCourse.id, userAId);
        await markLesson(incompleteCourse.id, lesson1.id, userAId, true);

        const completeCourse = await createCourse({
          title: 'My Learning e2e - completedAt non-null course',
        });
        const onlyLesson = await prisma.lesson.create({
          data: { courseId: completeCourse.id, title: 'Only lesson' },
        });
        await enroll(completeCourse.id, userAId);
        await markLesson(completeCourse.id, onlyLesson.id, userAId, true);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        const incompleteItem = body.find(
          (item) => item.course.id === incompleteCourse.id,
        );
        const completeItem = body.find(
          (item) => item.course.id === completeCourse.id,
        );
        expect(incompleteItem?.completedAt).toBeNull();
        expect(completeItem?.completedAt).not.toBeNull();
      });

      it('returns totalLessons: 0 and completionPercentage: 0 (not NaN) for a zero-lesson enrolled course', async () => {
        const course = await createCourse({
          title: 'My Learning e2e - zero-lesson course',
        });
        await enroll(course.id, userAId);

        const response = await getMyLearning(userAId).expect(200);

        const body = response.body as MyLearningItemResponseBody[];
        expect(body).toHaveLength(1);
        expect(body[0].totalLessons).toBe(0);
        expect(body[0].completionPercentage).toBe(0);
        expect(Number.isNaN(body[0].completionPercentage)).toBe(false);
        expect(body[0].completed).toBe(false);
        expect(body[0].completedAt).toBeNull();
      });
    });

    describe('user isolation', () => {
      it("never returns user B's enrollments, progress, or completion status in user A's response, and vice versa", async () => {
        const courseA = await createCourse({
          title: 'My Learning e2e - isolation - user A course',
        });
        const lessonA1 = await prisma.lesson.create({
          data: { courseId: courseA.id, title: 'Lesson A1' },
        });
        await prisma.lesson.create({
          data: { courseId: courseA.id, title: 'Lesson A2' },
        });
        await enroll(courseA.id, userAId);
        await markLesson(courseA.id, lessonA1.id, userAId, true);

        const sharedCourse = await createCourse({
          title: 'My Learning e2e - isolation - shared course',
        });
        const sharedLesson1 = await prisma.lesson.create({
          data: { courseId: sharedCourse.id, title: 'Shared Lesson 1' },
        });
        await prisma.lesson.create({
          data: { courseId: sharedCourse.id, title: 'Shared Lesson 2' },
        });
        await enroll(sharedCourse.id, userAId);
        await enroll(sharedCourse.id, userBId);
        // User B completes both lessons of the shared course; user A
        // completes none of them.
        const sharedLesson2 = await prisma.lesson.findFirstOrThrow({
          where: { courseId: sharedCourse.id, id: { not: sharedLesson1.id } },
        });
        await markLesson(sharedCourse.id, sharedLesson1.id, userBId, true);
        await markLesson(sharedCourse.id, sharedLesson2.id, userBId, true);

        const courseB = await createCourse({
          title: 'My Learning e2e - isolation - user B only course',
        });
        await enroll(courseB.id, userBId);

        const responseA = await getMyLearning(userAId).expect(200);
        const bodyA = responseA.body as MyLearningItemResponseBody[];
        expect(bodyA.map((item) => item.course.id).sort()).toEqual(
          [courseA.id, sharedCourse.id].sort(),
        );
        expect(bodyA.some((item) => item.course.id === courseB.id)).toBe(false);
        const sharedForA = bodyA.find(
          (item) => item.course.id === sharedCourse.id,
        );
        expect(sharedForA).toMatchObject({
          completedLessons: 0,
          completionPercentage: 0,
          completed: false,
          completedAt: null,
        });

        const responseB = await getMyLearning(userBId).expect(200);
        const bodyB = responseB.body as MyLearningItemResponseBody[];
        expect(bodyB.map((item) => item.course.id).sort()).toEqual(
          [courseB.id, sharedCourse.id].sort(),
        );
        expect(bodyB.some((item) => item.course.id === courseA.id)).toBe(false);
        const sharedForB = bodyB.find(
          (item) => item.course.id === sharedCourse.id,
        );
        expect(sharedForB).toMatchObject({
          completedLessons: 2,
          completionPercentage: 100,
          completed: true,
        });
        expect(sharedForB?.completedAt).not.toBeNull();
      });
    });

    describe('authn failures', () => {
      it('returns 401 with the standard error shape when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .get('/my-learning')
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/my-learning',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await getMyLearning('nonexistent-user-id').expect(401);
      });
    });
  });
});
