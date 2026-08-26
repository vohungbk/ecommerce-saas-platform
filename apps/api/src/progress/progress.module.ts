import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { CourseCompletionService } from './course-completion.service';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';

@Module({
  imports: [AuthModule, CoursesModule, EnrollmentsModule],
  controllers: [ProgressController],
  providers: [ProgressService, CourseCompletionService],
})
export class ProgressModule {}
