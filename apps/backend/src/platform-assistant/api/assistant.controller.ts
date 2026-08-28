import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { RateLimited } from '../../common/decorators/rate-limited.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformAssistantService } from '../application/assistant.service';
import type { RequestUser } from '../../common/types/authenticated-request';

export class AskAssistantDto {
  /**
   * La pregunta.
   *
   * Se acota la longitud porque entra en el contexto del modelo, no porque proteja de nada:
   * un texto de un megabyte gastaría la ventana entera en la propia pregunta. Lo que impide
   * que el contenido de esta cadena haga daño no es su tamaño, son las seis herramientas.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  question!: string;
}

/**
 * El asistente de operación.
 *
 * ## Dos rutas, y las dos de lectura
 *
 * No hay ninguna que escriba. No es que estén protegidas: es que no existen. El asistente
 * puede describir una acción —cambiar un plan, bloquear una cuenta— y ahí termina su trabajo:
 * ejecutarla exige que una persona la pulse en su pantalla, con su confirmación y su
 * reautenticación. La cadena de la Fase 4 no tiene un atajo para el asistente porque el
 * asistente no llega a ella.
 *
 * ## Y pasa por la misma puerta que el resto del panel
 *
 * `SuperAdminGuard`: rol de plataforma **y** verificación en dos pasos activa. Un asistente al
 * que se pudiera preguntar sin segundo factor sería la forma más cómoda de saltárselo.
 *
 * No lleva `RecentAuthGuard`, y es deliberado: preguntar es una lectura, y las lecturas que
 * usan una concesión ya vigente no vuelven a pedir la credencial (decisión de la Fase 4). Lo
 * que sí la exige es la acción que el asistente proponga, cuando quien la hace es la persona.
 */
@UseGuards(SuperAdminGuard)
@Controller('platform/assistant')
export class PlatformAssistantController {
  constructor(private readonly assistant: PlatformAssistantService) {}

  /**
   * Qué puede consultar, para enseñarlo ANTES de que nadie pregunte.
   *
   * Sale del catálogo cerrado. Es lo que evita que la pantalla prometa cosas que el asistente
   * no puede hacer, y lo que le ahorra a quien pregunta descubrir los límites a base de
   * chocarse con ellos.
   */
  @Get('capabilities')
  capabilities() {
    return this.assistant.capabilities();
  }

  /**
   * Preguntar.
   *
   * Con límite de peticiones: cada pregunta cuesta dinero en la cuenta de plataforma, y aquí
   * no hay presupuesto de cliente que frene un bucle accidental.
   */
  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @RateLimited('ask')
  async ask(@CurrentUser() admin: RequestUser, @Body() dto: AskAssistantDto) {
    return this.assistant.ask({ admin, question: dto.question });
  }
}
