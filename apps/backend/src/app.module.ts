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
import { IntegrationsModule } from './integrations/integrations.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { PrivacyModule } from './privacy/privacy.module';
import { PlatformAccessModule } from './platform-access/platform-access.module';
import { AlertsModule } from './alerts/alerts.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { rateLimitsFor } from './common/http/rate-limits';
import type { AppConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    /**
     * Límites de peticiones.
     *
     * El guard NO es global, igual que `OrgRoleGuard`: se aplica exactamente en las rutas que
     * lo necesitan (ver `common/http/rate-limits.ts`). Un límite global obligaría a acordarse
     * de excluir cada ruta interna, y el día que a alguien se le olvide, una sincronización
     * larga empezaría a recibir 429 sin que nadie entienda por qué.
     *
     * Aquí se declara el catálogo con los números ya escalados; cada ruta elige el suyo con
     * `@Throttle`.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        throttlers: Object.entries(
          rateLimitsFor(config.get('rateLimitMultiplier', { infer: true })),
        ).map(([name, policy]) => ({ name, ...policy })),
      }),
    }),
    PrismaModule,
    AuditModule,
    MailModule,
    AlertsModule,
    AuthModule,
    OrganizationsModule,
    PrivacyModule,
    PlatformAccessModule,
    AdminModule,
    LlmModule,
    KnowledgeEngineModule,
    UnderstandingEngineModule,
    ConversationsModule,
    AgentsModule,
    RecommendationsModule,
    AutomationsModule,
    ReportsModule,
    IntegrationsModule,
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
