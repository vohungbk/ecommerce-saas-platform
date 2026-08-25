import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';

@Module({
  providers: [AdminGuard, AuthGuard],
  exports: [AdminGuard, AuthGuard],
})
export class AuthModule {}
