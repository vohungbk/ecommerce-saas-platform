import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnrollmentsModule } from '../enrollments/enrollments.module';
import { MyLearningController } from './my-learning.controller';
import { MyLearningService } from './my-learning.service';

@Module({
  imports: [AuthModule, EnrollmentsModule],
  controllers: [MyLearningController],
  providers: [MyLearningService],
})
export class MyLearningModule {}
