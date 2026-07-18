import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AdminModule } from './admin/admin.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    AdminModule,
    LlmModule,
    HealthModule,
  ],
  providers: [
    // Global: toda ruta exige JWT salvo @Public(). OrgRoleGuard/SuperAdminGuard
    // NO son globales — se aplican explícitamente donde hace falta organización
    // activa o rol de plataforma (ver common/README.md).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
