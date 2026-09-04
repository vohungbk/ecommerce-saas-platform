import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { CoursesService } from '../courses/courses.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  let prisma: {
    review: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let coursesService: { findOne: jest.Mock };
  let enrollmentsService: { assertLearnerAccessToCourse: jest.Mock };
  let service: ReviewsService;

  const course = {
    id: 'course-1',
    title: 'Intro to TypeScript',
    description: null,
    status: 'PUBLISHED',
    instructorId: null,
    categoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const user: User = {
    id: 'user-1',
    email: 'learner@example.com',
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const admin: User = { ...user, id: 'admin-1', role: 'ADMIN' };

  const review = {
    id: 'review-1',
    userId: 'user-1',
    courseId: 'course-1',
    rating: 5,
    content: 'Great course',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      review: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(
        (ops: unknown[]) => Promise.all(ops) as Promise<unknown>,
      ),
    };
    coursesService = { findOne: jest.fn().mockResolvedValue(course) };
    enrollmentsService = {
      assertLearnerAccessToCourse: jest.fn().mockResolvedValue(course),
    };
    service = new ReviewsService(
      prisma as unknown as PrismaService,
      coursesService as unknown as CoursesService,
      enrollmentsService as unknown as EnrollmentsService,
    );
  });

  describe('create', () => {
    it('checks learner access, then creates a review with the caller as author', async () => {
      prisma.review.create.mockResolvedValue(review);

      const result = await service.create(
        'course-1',
        { rating: 5, content: 'Great course' },
        user,
      );

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(user, 'course-1');
      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          courseId: 'course-1',
          rating: 5,
          content: 'Great course',
        },
      });
      expect(result).toEqual(review);
    });

    it('persists content as omitted (not empty string) when the trimmed content is empty', async () => {
      prisma.review.create.mockResolvedValue(review);

      await service.create('course-1', { rating: 5, content: '' }, user);

      expect(prisma.review.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          courseId: 'course-1',
          rating: 5,
          content: undefined,
        },
      });
    });

    it('propagates NotFoundException("Enrollment not found") and never creates a row', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new NotFoundException('Enrollment not found'),
      );

      await expect(
        service.create('course-1', { rating: 5 }, user),
      ).rejects.toThrow(new NotFoundException('Enrollment not found'));
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException when the course is not currently PUBLISHED', async () => {
      enrollmentsService.assertLearnerAccessToCourse.mockRejectedValue(
        new ForbiddenException('Course is not currently available'),
      );

      await expect(
        service.create('course-1', { rating: 5 }, user),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.review.create).not.toHaveBeenCalled();
    });

    it('succeeds for an ADMIN caller even without enrollment (assertLearnerAccessToCourse bypass)', async () => {
      prisma.review.create.mockResolvedValue({
        ...review,
        userId: 'admin-1',
      });

      const result = await service.create('course-1', { rating: 4 }, admin);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).toHaveBeenCalledWith(admin, 'course-1');
      expect(result.userId).toBe('admin-1');
    });

    it('throws ConflictException when prisma reports a P2002 unique constraint violation (duplicate review)', async () => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: 'test' },
      );
      prisma.review.create.mockRejectedValue(error);

      await expect(
        service.create('course-1', { rating: 5 }, user),
      ).rejects.toThrow(ConflictException);
    });

    it('rethrows an unrelated error unchanged', async () => {
      const error = new Error('unexpected db failure');
      prisma.review.create.mockRejectedValue(error);

      await expect(
        service.create('course-1', { rating: 5 }, user),
      ).rejects.toThrow(error);
    });
  });

  describe('findAllForCourse', () => {
    it('paginates reviews for a PUBLISHED course', async () => {
      prisma.review.findMany.mockResolvedValue([review]);
      prisma.review.count.mockResolvedValue(1);

      const result = await service.findAllForCourse(
        'course-1',
        { page: 1, limit: 10 },
        user,
      );

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(prisma.review.findMany).toHaveBeenCalledWith({
        where: { courseId: 'course-1' },
        skip: 0,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      expect(result).toEqual({
        data: [review],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
    });

    it('does not require the caller to be enrolled', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      await service.findAllForCourse('course-1', {}, user);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException("Course not found") for a non-existent course', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(
        service.findAllForCourse('missing-course', {}, user),
      ).rejects.toThrow(new NotFoundException('Course not found'));
      expect(prisma.review.findMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Course not found") for a non-admin caller when the course is DRAFT', async () => {
      coursesService.findOne.mockResolvedValue({ ...course, status: 'DRAFT' });

      await expect(
        service.findAllForCourse('course-1', {}, user),
      ).rejects.toThrow(new NotFoundException('Course not found'));
      expect(prisma.review.findMany).not.toHaveBeenCalled();
    });

    it('allows an ADMIN caller to list reviews for a DRAFT course', async () => {
      coursesService.findOne.mockResolvedValue({ ...course, status: 'DRAFT' });
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      const result = await service.findAllForCourse('course-1', {}, admin);

      expect(result.data).toEqual([]);
    });

    it('defaults page/limit when not provided', async () => {
      prisma.review.findMany.mockResolvedValue([]);
      prisma.review.count.mockResolvedValue(0);

      const result = await service.findAllForCourse('course-1', {}, user);

      expect(prisma.review.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('getSummary', () => {
    it('returns averageRating rounded to 1 decimal, totalReviews, and a fully-keyed distribution', async () => {
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: 4.3333 },
        _count: 3,
      });
      prisma.review.groupBy.mockResolvedValue([
        { rating: 4, _count: { rating: 2 } },
        { rating: 5, _count: { rating: 1 } },
      ]);

      const result = await service.getSummary('course-1', user);

      expect(coursesService.findOne).toHaveBeenCalledWith('course-1');
      expect(result).toEqual({
        courseId: 'course-1',
        averageRating: 4.3,
        totalReviews: 3,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 },
      });
    });

    it('returns averageRating null and an all-zero distribution when there are no reviews', async () => {
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: 0,
      });
      prisma.review.groupBy.mockResolvedValue([]);

      const result = await service.getSummary('course-1', user);

      expect(result).toEqual({
        courseId: 'course-1',
        averageRating: null,
        totalReviews: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      });
    });

    it('does not require the caller to be enrolled', async () => {
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: 0,
      });
      prisma.review.groupBy.mockResolvedValue([]);

      await service.getSummary('course-1', user);

      expect(
        enrollmentsService.assertLearnerAccessToCourse,
      ).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException("Course not found") for a non-existent course', async () => {
      coursesService.findOne.mockRejectedValue(
        new NotFoundException('Course not found'),
      );

      await expect(service.getSummary('missing-course', user)).rejects.toThrow(
        new NotFoundException('Course not found'),
      );
      expect(prisma.review.aggregate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Course not found") for a non-admin caller when the course is DRAFT', async () => {
      coursesService.findOne.mockResolvedValue({ ...course, status: 'DRAFT' });

      await expect(service.getSummary('course-1', user)).rejects.toThrow(
        new NotFoundException('Course not found'),
      );
      expect(prisma.review.aggregate).not.toHaveBeenCalled();
    });

    it('allows an ADMIN caller to view the summary for a DRAFT course', async () => {
      coursesService.findOne.mockResolvedValue({ ...course, status: 'DRAFT' });
      prisma.review.aggregate.mockResolvedValue({
        _avg: { rating: null },
        _count: 0,
      });
      prisma.review.groupBy.mockResolvedValue([]);

      const result = await service.getSummary('course-1', admin);

      expect(result.courseId).toBe('course-1');
    });
  });

  describe('update', () => {
    it("updates the author's own review", async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.update.mockResolvedValue({ ...review, rating: 3 });

      const result = await service.update(
        'course-1',
        'review-1',
        { rating: 3 },
        user,
      );

      expect(prisma.review.findFirst).toHaveBeenCalledWith({
        where: { id: 'review-1', courseId: 'course-1' },
      });
      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { rating: 3 },
      });
      expect(result.rating).toBe(3);
    });

    it('allows an ADMIN to update a review authored by someone else', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.update.mockResolvedValue({ ...review, rating: 1 });

      const result = await service.update(
        'course-1',
        'review-1',
        { rating: 1 },
        admin,
      );

      expect(result.rating).toBe(1);
    });

    it('throws NotFoundException("Review not found") for a caller who is neither the author nor an ADMIN', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      const otherUser: User = { ...user, id: 'user-2' };

      await expect(
        service.update('course-1', 'review-1', { rating: 1 }, otherUser),
      ).rejects.toThrow(new NotFoundException('Review not found'));
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Review not found") when the review does not exist', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(
        service.update('course-1', 'missing-review', { rating: 1 }, user),
      ).rejects.toThrow(new NotFoundException('Review not found'));
      expect(prisma.review.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Review not found") when the review belongs to a different course', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(
        service.update('other-course', 'review-1', { rating: 1 }, user),
      ).rejects.toThrow(new NotFoundException('Review not found'));
      expect(prisma.review.findFirst).toHaveBeenCalledWith({
        where: { id: 'review-1', courseId: 'other-course' },
      });
    });

    it('persists content as null (not empty string) when the trimmed content is empty', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.update.mockResolvedValue({ ...review, content: null });

      await service.update('course-1', 'review-1', { content: '' }, user);

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { content: null },
      });
    });

    it('leaves fields untouched when not present in the DTO', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.update.mockResolvedValue(review);

      await service.update('course-1', 'review-1', {}, user);

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: {},
      });
    });
  });

  describe('remove', () => {
    it("deletes the author's own review", async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.delete.mockResolvedValue(review);

      const result = await service.remove('course-1', 'review-1', user);

      expect(prisma.review.delete).toHaveBeenCalledWith({
        where: { id: 'review-1' },
      });
      expect(result).toEqual(review);
    });

    it('allows an ADMIN to delete a review authored by someone else', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      prisma.review.delete.mockResolvedValue(review);

      await service.remove('course-1', 'review-1', admin);

      expect(prisma.review.delete).toHaveBeenCalledWith({
        where: { id: 'review-1' },
      });
    });

    it('throws NotFoundException("Review not found") for a caller who is neither the author nor an ADMIN, and does not delete', async () => {
      prisma.review.findFirst.mockResolvedValue(review);
      const otherUser: User = { ...user, id: 'user-2' };

      await expect(
        service.remove('course-1', 'review-1', otherUser),
      ).rejects.toThrow(new NotFoundException('Review not found'));
      expect(prisma.review.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException("Review not found") when the review does not exist', async () => {
      prisma.review.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('course-1', 'missing-review', user),
      ).rejects.toThrow(new NotFoundException('Review not found'));
      expect(prisma.review.delete).not.toHaveBeenCalled();
    });
  });
});
