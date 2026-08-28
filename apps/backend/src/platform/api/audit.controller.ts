import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { PlatformOrganizationsService } from '../application/organizations.service';
import { PlatformAuditService } from '../application/platform-audit.service';

/**
 * Qué ha hecho la administración de BusinessBrain, y los números del producto.
 *
 * ## Esto NO es la auditoría del sistema
 *
 * Es la de la plataforma. La actividad de cada empresa no aparece aquí: leerla sería saber de
 * qué habla su negocio sin abrir un solo documento suyo, que es exactamente la vía indirecta
 * que la separación existe para cerrar.
 *
 * Lo que se devuelve sale de una LISTA CERRADA de acciones, no de un filtro por prefijo. Un
 * `action LIKE 'platform.%'` habría omitido en silencio las acciones administrativas que no
 * llevaban el prefijo —existieron— y habría enseñado las de cliente que se escriben sin
 * organización, como el borrado de datos. Ver `audit/domain/platform-actions.ts`.
 *
 * ## Y leer la auditoría NO se audita
 *
 * Decisión congelada, y por un motivo concreto: si cada lectura dejara una entrada, la
 * siguiente lectura devolvería sobre todo entradas de lecturas anteriores. El registro de
 * acciones administrativas se convertiría en el registro de sus propias consultas, y las
 * acciones de verdad quedarían enterradas bajo el ruido que genera mirarlas.
 *
 * La excepción son los listados de PERSONAS, que sí dejan traza: ahí lo que se lee son datos
 * personales de terceros, no la actividad propia.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform')
export class PlatformAuditController {
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly organizations: PlatformOrganizationsService,
  ) {}

  /** Los números del producto entero. De aquí no se deduce nada de ningún cliente. */
  @Get('overview')
  async overview() {
    return this.organizations.overview();
  }

  @Get('audit')
  async list(
    @Query('page') page?: string,
    @Query('code') code?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.audit.list({ page: Number(page), code, organizationId });
  }

  /**
   * Las acciones consultables.
   *
   * Códigos estables, sin una palabra traducida: quien los enseñe decide en qué idioma. Es lo
   * que permite que el panel funcione en castellano y en inglés —y mañana en catalán— sin que
   * la API sepa nada de idiomas.
   */
  @Get('audit/actions')
  actions(): string[] {
    return this.audit.catalog();
  }
}
