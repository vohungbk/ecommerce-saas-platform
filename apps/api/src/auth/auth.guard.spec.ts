import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
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

describe('AuthGuard', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let guard: AuthGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    guard = new AuthGuard(prisma as unknown as PrismaService);
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

  it('passes and attaches the user to the request for a regular USER', async () => {
    const { context, request } = createContext({ 'x-user-id': 'user-1' });
    const regularUser = { id: 'user-1', role: 'USER' };
    prisma.user.findUnique.mockResolvedValue(regularUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(regularUser);
  });

  it('passes and attaches the user to the request for an ADMIN', async () => {
    const { context, request } = createContext({ 'x-user-id': 'admin-1' });
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    prisma.user.findUnique.mockResolvedValue(adminUser);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(adminUser);
  });
});
