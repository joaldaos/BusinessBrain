import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { RateLimited } from '../../common/decorators/rate-limited.decorator';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { MfaService } from '../application/mfa.service';
import { MfaAdministrationService } from '../application/mfa-administration.service';
import { ConfirmMfaDto } from '../dto/mfa.dto';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';

/**
 * La verificación en dos pasos, desde la cuenta de quien la usa.
 *
 * ## Estas rutas NO llevan `RecentAuthGuard` en el alta
 *
 * Activarla es hacerse más seguro: exigir una prueba extra para poder protegerse mejor solo
 * consigue que menos gente lo haga. Quitársela sí, porque es hacerse menos seguro — y es
 * exactamente la acción que ejecutaría alguien que hubiera robado una sesión.
 *
 * Regenerar los códigos también, por lo mismo: quien los regenera invalida los anteriores, así
 * que sería la forma de dejar sin salida a la persona legítima.
 */
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  /** Qué tiene esta cuenta ahora mismo. Nunca el secreto ni los códigos. */
  @Get()
  async status(@CurrentUser() user: RequestUser) {
    return this.mfa.statusFor(user.id);
  }

  /** Primer paso: el QR. Todavía no activa nada. */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  async setup(@CurrentUser() user: RequestUser) {
    return this.mfa.beginEnrollment(user.id);
  }

  /**
   * Segundo paso: el primer código correcto activa la verificación.
   *
   * Devuelve los códigos de recuperación. Es la única vez que existen legibles — después de
   * esta respuesta solo queda su HMAC, y no hay ninguna ruta que los devuelva.
   */
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimited('mfa')
  async confirm(@CurrentUser() user: RequestUser, @Body() dto: ConfirmMfaDto) {
    return this.mfa.confirmEnrollment(user.id, dto.code);
  }

  /** Quitársela. Exige haber demostrado la identidad hace poco. */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.MFA_DISABLE)
  async disable(@CurrentUser() user: RequestUser) {
    return this.mfa.disable(user.id);
  }

  /** Diez códigos nuevos; los anteriores dejan de valer. */
  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.MFA_RECOVERY_CODES_REGENERATE)
  async regenerate(@CurrentUser() user: RequestUser) {
    return this.mfa.regenerateRecoveryCodes(user.id);
  }
}

/**
 * El propietario retira el segundo factor de un administrador de SU empresa.
 *
 * Vive en su propia clase porque la puerta es otra: `OrgRoleGuard` resuelve la organización y
 * exige propietario, cosa que las rutas de `/auth/mfa` no hacen ni deben hacer.
 *
 * Retirar el segundo factor de alguien no es entrar en su cuenta: después sigue haciendo falta
 * su contraseña, que aquí no se lee, no se cambia y no se puede fijar. No se devuelve ninguna
 * sesión ni ningún token.
 */
@UseGuards(OrgRoleGuard, RecentAuthGuard)
@OrgRoles(MembershipRole.OWNER)
@Controller('organizations/:organizationId/members')
export class OrganizationMfaController {
  constructor(private readonly administration: MfaAdministrationService) {}

  @Post(':userId/mfa/remove')
  @HttpCode(HttpStatus.OK)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.MFA_REMOVE_FROM_MEMBER)
  async remove(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() owner: RequestUser,
    @Param('userId') targetUserId: string,
  ) {
    return this.administration.removeByOwner({
      organizationId: org.id,
      ownerUserId: owner.id,
      ownerRole: org.role,
      targetUserId,
    });
  }
}
