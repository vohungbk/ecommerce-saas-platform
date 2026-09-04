import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { CoursesModule } from './courses/courses.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { HealthModule } from './health/health.module';
import { MyLearningModule } from './my-learning/my-learning.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgressModule } from './progress/progress.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    CoursesModule,
    CategoriesModule,
    EnrollmentsModule,
    ProgressModule,
    MyLearningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
