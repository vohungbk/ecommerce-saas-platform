import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

interface CategoryResponseBody {
  id: string;
  name: string;
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

describe('CategoriesController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let adminId: string;
  let instructorId: string;
  let userId: string;
  const createdCategoryIds: string[] = [];

  const ADMIN_EMAIL = 'categories-e2e-admin@example.com';
  const INSTRUCTOR_EMAIL = 'categories-e2e-instructor@example.com';
  const USER_EMAIL = 'categories-e2e-user@example.com';

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

    const instructor = await prisma.user.upsert({
      where: { email: INSTRUCTOR_EMAIL },
      update: { role: 'INSTRUCTOR' },
      create: { email: INSTRUCTOR_EMAIL, role: 'INSTRUCTOR' },
    });
    instructorId = instructor.id;

    const user = await prisma.user.upsert({
      where: { email: USER_EMAIL },
      update: { role: 'USER' },
      create: { email: USER_EMAIL, role: 'USER' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    if (createdCategoryIds.length > 0) {
      await prisma.category.deleteMany({
        where: { id: { in: createdCategoryIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN_EMAIL, INSTRUCTOR_EMAIL, USER_EMAIL] } },
    });
    await app.close();
  });

  describe('POST /categories', () => {
    describe('success', () => {
      it('creates a category with a trimmed name and returns 201 with the persisted row', async () => {
        const response = await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: '  Web Development  ' })
          .expect(201);

        const body = response.body as CategoryResponseBody;
        createdCategoryIds.push(body.id);

        expect(body.name).toBe('Web Development');
        expect(body.id).toEqual(expect.any(String));
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();

        const persisted = await prisma.category.findUnique({
          where: { id: body.id },
        });
        expect(persisted?.name).toBe('Web Development');
      });
    });

    describe('validation failures', () => {
      it('rejects a name shorter than 2 characters', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: 'a' })
          .expect(400);
      });

      it('rejects a name longer than 100 characters', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: 'a'.repeat(101) })
          .expect(400);
      });

      it('rejects a whitespace-only name', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: '   ' })
          .expect(400);
      });

      it('rejects a missing name', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({})
          .expect(400);
      });

      it('rejects an extraneous field', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: 'Valid Category', slug: 'valid-category' })
          .expect(400);
      });
    });

    describe('conflict', () => {
      it('returns 409 for a duplicate name and does not create a new row', async () => {
        const first = await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: 'Duplicate Category' })
          .expect(201);
        const firstBody = first.body as CategoryResponseBody;
        createdCategoryIds.push(firstBody.id);

        const beforeCount = await prisma.category.count();

        const response = await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', adminId)
          .send({ name: 'Duplicate Category' })
          .expect(409);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 409,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/categories',
          timestamp: expect.any(String) as string,
        });

        const afterCount = await prisma.category.count();
        expect(afterCount).toBe(beforeCount);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .post('/categories')
          .send({ name: 'Missing Header Category' })
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/categories',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', 'nonexistent-user-id')
          .send({ name: 'Unknown User Category' })
          .expect(401);
      });

      it('returns 403 for an INSTRUCTOR caller and does not create a category', async () => {
        const beforeCount = await prisma.category.count();

        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', instructorId)
          .send({ name: 'Instructor Category' })
          .expect(403);

        const afterCount = await prisma.category.count();
        expect(afterCount).toBe(beforeCount);
      });

      it('returns 403 for a plain USER caller and does not create a category', async () => {
        const beforeCount = await prisma.category.count();

        await request(app.getHttpServer())
          .post('/categories')
          .set('x-user-id', userId)
          .send({ name: 'User Category' })
          .expect(403);

        const afterCount = await prisma.category.count();
        expect(afterCount).toBe(beforeCount);
      });
    });
  });

  describe('GET /categories', () => {
    let categoryAId: string;
    let categoryBId: string;

    beforeAll(async () => {
      // Scope the reset to categories this file itself created (tracked in
      // createdCategoryIds) rather than wiping the whole table - the
      // Category table is no longer owned solely by this spec file
      // (courses.e2e-spec.ts and instructor-courses.e2e-spec.ts also create
      // Category rows in the shared test DB).
      await prisma.category.deleteMany({
        where: { id: { in: createdCategoryIds } },
      });

      const categoryB = await prisma.category.create({
        data: { name: 'Zzz Category' },
      });
      const categoryA = await prisma.category.create({
        data: { name: 'Aaa Category' },
      });
      categoryAId = categoryA.id;
      categoryBId = categoryB.id;
    });

    afterAll(async () => {
      await prisma.category.deleteMany({
        where: { id: { in: [categoryAId, categoryBId] } },
      });
    });

    describe('success', () => {
      it('returns all categories sorted by name ascending', async () => {
        const response = await request(app.getHttpServer())
          .get('/categories')
          .set('x-user-id', adminId)
          .expect(200);

        const body = response.body as CategoryResponseBody[];
        expect(body).toHaveLength(2);
        expect(body.map((c) => c.id)).toEqual([categoryAId, categoryBId]);
      });

      it('allows an INSTRUCTOR caller', async () => {
        await request(app.getHttpServer())
          .get('/categories')
          .set('x-user-id', instructorId)
          .expect(200);
      });

      it('allows a plain USER caller', async () => {
        await request(app.getHttpServer())
          .get('/categories')
          .set('x-user-id', userId)
          .expect(200);
      });

      it('returns an empty array without error when there are no categories', async () => {
        await prisma.category.deleteMany({
          where: { id: { in: [categoryAId, categoryBId] } },
        });

        const response = await request(app.getHttpServer())
          .get('/categories')
          .set('x-user-id', adminId)
          .expect(200);

        expect(response.body).toEqual([]);
      });
    });

    describe('authn/authz failures', () => {
      it('returns 401 when the x-user-id header is missing', async () => {
        const response = await request(app.getHttpServer())
          .get('/categories')
          .expect(401);

        const body = response.body as ErrorResponseBody;
        expect(body).toMatchObject({
          statusCode: 401,
          error: expect.any(String) as string,
          message: expect.any(String) as string,
          path: '/categories',
          timestamp: expect.any(String) as string,
        });
      });

      it('returns 401 when the x-user-id header does not match an existing user', async () => {
        await request(app.getHttpServer())
          .get('/categories')
          .set('x-user-id', 'nonexistent-user-id')
          .expect(401);
      });
    });
  });
});
