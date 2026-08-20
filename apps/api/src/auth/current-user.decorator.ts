import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';

/**
 * Reads the `User` attached to the request by `AdminGuard` (or any future
 * auth guard that sets `request.user`). Development-only identity model —
 * see `admin.guard.ts` for the caveats.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    return request.user;
  },
);
