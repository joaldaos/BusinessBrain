import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, PlatformAuditService],
})
export class AdminModule {}
