import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { AdminModule } from './admin/admin.module';
import { LlmModule } from './llm/llm.module';
import { KnowledgeEngineModule } from './knowledge-engine/knowledge-engine.module';
import { UnderstandingEngineModule } from './understanding-engine/understanding-engine.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AgentsModule } from './agents/agents.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { AutomationsModule } from './automations/automations.module';
import { ReportsModule } from './reports/reports.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    AdminModule,
    LlmModule,
    KnowledgeEngineModule,
    UnderstandingEngineModule,
    ConversationsModule,
    AgentsModule,
    RecommendationsModule,
    AutomationsModule,
    ReportsModule,
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
