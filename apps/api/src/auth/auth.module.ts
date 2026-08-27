import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';
import { InstructorGuard } from './instructor.guard';

@Module({
  providers: [AdminGuard, AuthGuard, InstructorGuard],
  exports: [AdminGuard, AuthGuard, InstructorGuard],
})
export class AuthModule {}
