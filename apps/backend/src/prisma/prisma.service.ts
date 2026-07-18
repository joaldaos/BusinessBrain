import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@businessbrain/database';

/**
 * Envoltorio fino sobre el PrismaClient compartido (@businessbrain/database).
 * No añade lógica de negocio ni scoping por organización aquí todavía — cada
 * módulo (auth, organizations, admin...) filtra por organizationId/userId de
 * forma explícita en sus propias queries. Row-Level Security como segunda capa
 * de aislamiento está planificado para la fase de hardening (§10 fase 9 del
 * documento de arquitectura), no en esta fase.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Conectado a PostgreSQL vía Prisma');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
