import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../auth/admin.guard';
import { CoursesService } from './courses.service';
import { CreateCourseDto } from './dto/create-course.dto';

@ApiTags('courses')
@ApiHeader({
  name: 'x-user-id',
  description:
    'Development-only identity shim: id of an existing admin User. Not production auth.',
  required: true,
})
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Create a course (admin only)',
    description:
      'Creates a new course with status DRAFT. Requires the caller to be an admin (development-only x-user-id header shim, see AdminGuard).',
  })
  @ApiResponse({ status: 201, description: 'Course created' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Missing or unknown x-user-id' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  create(@Body() dto: CreateCourseDto) {
    return this.coursesService.create(dto);
  }
}
