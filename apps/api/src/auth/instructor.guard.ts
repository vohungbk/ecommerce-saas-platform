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
 * Same `x-user-id` → `User` lookup as `AdminGuard`/`AuthGuard` (see
 * `admin.guard.ts` for the full caveats about this shim), but the role
 * check allows either `INSTRUCTOR` or `ADMIN` through — admin always
 * bypasses instructor-only ownership rules, matching the existing project
 * convention (see `EnrollmentsService.assertLearnerAccessToCourse`).
 */
@Injectable()
export class InstructorGuard implements CanActivate {
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

    if (user.role !== 'INSTRUCTOR' && user.role !== 'ADMIN') {
      throw new ForbiddenException('Instructor role required');
    }

    request.user = user;
    return true;
  }
}
