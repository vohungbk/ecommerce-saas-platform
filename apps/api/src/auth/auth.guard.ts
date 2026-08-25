import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

/**
 * DEVELOPMENT-ONLY identity shim — NOT production auth.
 *
 * Same `x-user-id` → `User` lookup as `AdminGuard`, but with no role
 * requirement: any authenticated user (any role) is allowed through. Use
 * this guard for routes that only need "an authenticated user", not
 * "an admin". See `admin.guard.ts` for the full caveats about this shim.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    const userId = request.headers['x-user-id'];

    if (!userId || Array.isArray(userId)) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = user;
    return true;
  }
}
