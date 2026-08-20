import { CoursesService } from './courses.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';

describe('CoursesService', () => {
  let prisma: { course: { create: jest.Mock } };
  let service: CoursesService;

  beforeEach(() => {
    prisma = { course: { create: jest.fn().mockResolvedValue({}) } };
    service = new CoursesService(prisma as unknown as PrismaService);
  });

  it('always persists status DRAFT regardless of any extraneous input', async () => {
    const dto = { title: 'Intro to TypeScript' } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'DRAFT' }) as unknown,
    });
  });

  it('trims title and description before persisting', async () => {
    const dto = {
      title: '  Intro to TypeScript  ',
      description: '  A beginner course  ',
    } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Intro to TypeScript',
        description: 'A beginner course',
        status: 'DRAFT',
      },
    });
  });

  it('passes description through as undefined when not provided', async () => {
    const dto = { title: 'Intro to TypeScript' } as CreateCourseDto;

    await service.create(dto);

    expect(prisma.course.create).toHaveBeenCalledWith({
      data: {
        title: 'Intro to TypeScript',
        description: undefined,
        status: 'DRAFT',
      },
    });
  });
});
