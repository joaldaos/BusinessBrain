import { Module } from '@nestjs/common';
import { PrivacyController } from './api/privacy.controller';
import { OrganizationExportService } from './application/organization-export.service';
import { OrganizationErasureService } from './application/organization-erasure.service';

@Module({
  controllers: [PrivacyController],
  providers: [OrganizationExportService, OrganizationErasureService],
})
export class PrivacyModule {}
