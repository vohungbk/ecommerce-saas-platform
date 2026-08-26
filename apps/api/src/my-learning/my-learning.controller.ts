import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { MyLearningService } from './my-learning.service';

@ApiTags('my-learning')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User (any role). Not production auth.',
  required: true,
})
@Controller('my-learning')
export class MyLearningController {
  constructor(private readonly myLearningService: MyLearningService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: "List the caller's own enrolled courses with progress",
    description:
      "Returns the authenticated caller's own enrolled courses, each annotated with lesson progress counts, completion percentage, and completion status. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role. Never returns another user's enrollments, progress, or completion status.",
  })
  @ApiResponse({
    status: 200,
    description:
      "The caller's enrolled courses with progress, ordered by enrollment date descending. Empty array if the caller has no enrollments.",
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
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
          enrolledAt: { type: 'string', format: 'date-time' },
          totalLessons: { type: 'number' },
          completedLessons: { type: 'number' },
          remainingLessons: { type: 'number' },
          completionPercentage: { type: 'number' },
          completed: { type: 'boolean' },
          completedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  findMine(@CurrentUser() user: User) {
    return this.myLearningService.findForUser(user.id);
  }
}
