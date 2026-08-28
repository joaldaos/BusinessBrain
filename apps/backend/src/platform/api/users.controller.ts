import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { RequiresRecentAuth } from '../../common/decorators/requires-recent-auth.decorator';
import { SENSITIVE_ACTIONS } from '../../common/security/sensitive-actions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformUsersService } from '../application/users.service';
import { MfaAdministrationService } from '../../auth/application/mfa-administration.service';
import { RemoveMfaDto } from '../../auth/dto/mfa.dto';
import type { RequestUser } from '../../common/types/authenticated-request';

/**
 * Las personas, desde la administración del producto.
 *
 * Las dos lecturas quedan registradas —son datos personales de empleados de empresas
 * clientes—, y las tres escrituras exigen credencial reciente.
 *
 * Ninguna de ellas devuelve nada con lo que suplantar a nadie: ni contraseña, ni su hash, ni
 * el secreto del segundo factor, ni códigos de recuperación, ni tokens. No es que se filtren
 * al salir: es que las consultas no los traen.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform/users')
export class PlatformUsersController {
  constructor(
    private readonly users: PlatformUsersService,
    private readonly mfaAdministration: MfaAdministrationService,
  ) {}

  @Get()
  async list(@CurrentUser() actor: RequestUser, @Query('page') page?: string) {
    return this.users.list({ page: Number(page), actorId: actor.id });
  }

  /** La ficha de una persona: para atender "no puedo entrar con esta cuenta". */
  @Get(':userId')
  async detail(
    @Param('userId') userId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.users.detail({ userId, actorId: actor.id });
  }

  /**
   * Bloquear una cuenta.
   *
   * Dos rutas y no un interruptor: quien llama declara el estado que quiere, así que repetir
   * la llamada es inofensivo y la traza dice lo que ocurrió de verdad. Ver el servicio.
   */
  @Post(':userId/ban')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.USER_BAN)
  async ban(
    @Param('userId') userId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.users.setBanned({ userId, banned: true, actorId: actor.id });
  }

  @Post(':userId/unban')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.USER_BAN)
  async unban(
    @Param('userId') userId: string,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.users.setBanned({ userId, banned: false, actorId: actor.id });
  }

  /**
   * Retirar la verificación en dos pasos de una cuenta de cliente. Último recurso.
   *
   * **No da acceso a nada.** Después sigue haciendo falta la contraseña de esa persona, que
   * aquí no se lee, no se cambia y no se puede fijar: no se emite sesión ni se devuelve ningún
   * token. Motivo obligatorio, y avisa por correo al afectado y al propietario de su empresa.
   */
  @Post(':userId/mfa/remove')
  @UseGuards(RecentAuthGuard)
  @RequiresRecentAuth(SENSITIVE_ACTIONS.MFA_REMOVE_FROM_PLATFORM)
  async removeMfa(
    @Param('userId') userId: string,
    @Body() dto: RemoveMfaDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.mfaAdministration.removeByPlatform({
      actorId: actor.id,
      targetUserId: userId,
      reason: dto.reason,
    });
  }
}
