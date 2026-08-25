import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { EnrollCourseParamsDto } from './dto/enroll-course-params.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('enrollments')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing User (any role). Not production auth.',
  required: true,
})
@Controller('courses/:courseId')
export class CourseEnrollmentController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Enroll the caller in a course',
    description:
      'Enrolls the authenticated caller in the given course. The course must exist, not be soft-deleted, and be PUBLISHED. Requires the caller to be an authenticated user (development-only x-user-id header shim, see AuthGuard) — any role.',
  })
  @ApiParam({ name: 'courseId', description: 'Course id' })
  @ApiResponse({
    status: 201,
    description: 'The created enrollment',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        userId: { type: 'string' },
        courseId: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 404, description: 'Course not found' })
  @ApiResponse({
    status: 409,
    description:
      'Course is not PUBLISHED, or the caller is already enrolled in this course',
  })
  enroll(@Param() params: EnrollCourseParamsDto, @CurrentUser() user: User) {
    return this.enrollmentsService.enroll(params.courseId, user.id);
  }
}
