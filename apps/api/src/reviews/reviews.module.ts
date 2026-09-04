import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoursesModule } from '../courses/courses.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { CourseReviewsController } from './course-reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule, CoursesModule, EnrollmentsModule],
  controllers: [CourseReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
