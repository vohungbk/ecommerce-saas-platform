import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '@prisma/client';

/**
 * DEVELOPMENT-ONLY identity/authorization shim — NOT production auth.
 *
 * There is no login/session/JWT flow in this codebase yet (Phase 0). Until
 * the real auth phase is built, this guard trusts an `x-user-id` header as
 * the caller's claimed identity: anyone can claim to be any user id by
 * setting this header, which is a known, accepted hole for now. The *role*
 * itself is never trusted from the client — it is always looked up
 * server-side from the `User` row in the database via `PrismaService`.
 *
 * Do not copy this pattern to other endpoints, and replace it entirely once
 * real authentication (login + session/JWT) is implemented.
 */
@Injectable()
export class AdminGuard implements CanActivate {
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

    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Admin role required');
    }

    request.user = user;
    return true;
  }
}
