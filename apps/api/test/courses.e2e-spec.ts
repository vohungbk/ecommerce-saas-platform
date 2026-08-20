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
});
