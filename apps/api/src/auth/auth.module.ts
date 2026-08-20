import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

@Module({
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AuthModule {}
