import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [AuthModule],
  controllers: [CoursesController, LessonsController],
  providers: [CoursesService, LessonsService],
  exports: [CoursesService, LessonsService],
})
export class CoursesModule {}
