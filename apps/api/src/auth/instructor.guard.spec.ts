import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InstructorGuard } from './instructor.guard';
import { PrismaService } from '../prisma/prisma.service';

function createContext(headers: Record<string, string | undefined>) {
  const request: {
    headers: Record<string, string | undefined>;
    user?: unknown;
  } = {
    headers,
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('InstructorGuard', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let guard: InstructorGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new InstructorGuard(prisma as unknown as PrismaService);
  });

  it('throws 401 when the x-user-id header is missing', async () => {
    const { context } = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws 401 when the x-user-id header does not match an existing user', async () => {
    const { context } = createContext({ 'x-user-id': 'nonexistent-id' });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'nonexistent-id' },
    });
  });

  it('throws 403 when the user exists but is a plain USER', async () => {
    const { context } = createContext({ 'x-user-id': 'user-1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      role: 'USER',
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes and attaches the user to the request when the user is an INSTRUCTOR', async () => {
    const { context, request } = createContext({
      'x-user-id': 'instructor-1',
    });
    const instructorUser = { id: 'instructor-1', role: 'INSTRUCTOR' };
    prisma.user.findUnique.mockResolvedValue(instructorUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(instructorUser);
  });

  it('passes and attaches the user to the request when the user is an ADMIN', async () => {
    const { context, request } = createContext({ 'x-user-id': 'admin-1' });
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    prisma.user.findUnique.mockResolvedValue(adminUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(adminUser);
  });
});
