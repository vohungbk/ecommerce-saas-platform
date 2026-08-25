import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('enrollments')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User (any role). Not production auth.',
  required: true,
})
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "List the caller's own enrollments",
    description:
      "Returns the authenticated caller's own enrollments, each including the enrolled course. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role. Never returns another user's enrollments.",
  })
  @ApiResponse({
    status: 200,
    description: "The caller's enrollments, newest first",
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          courseId: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          course: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string', nullable: true },
              status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'] },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  findMine(@CurrentUser() user: User) {
    return this.enrollmentsService.findAllForUser(user.id);
  }
}
