import { Module } from '@nestjs/common';
import { PlatformAssistantController } from './api/assistant.controller';
import { PlatformAssistantService } from './application/assistant.service';
import { AssistantToolRunner } from './application/tool-runner.service';
import { LlmModule } from '../llm/llm.module';
import { PlatformModule } from '../platform/platform.module';
import { PlatformAccessModule } from '../platform-access/platform-access.module';

/**
 * El asistente de operación.
 *
 * ## Lo que este módulo NO importa, y es la mitad de la garantía
 *
 * No importa `PrismaModule`. No tiene acceso a la base de datos, ni directo ni a través de un
 * repositorio propio. Todo lo que puede consultar llega por servicios de aplicación que ya
 * existían y que ya tenían sus garantías: selecciones explícitas, listas cerradas, y la
 * comprobación de concesión de la Fase 3.
 *
 * Tampoco importa nada que hable con el exterior más allá del proveedor de modelo. No hay
 * cliente HTTP, ni sistema de ficheros, ni acceso a variables de entorno.
 *
 * Una prueba estructural recorre los ficheros de este módulo y falla si alguno menciona
 * Prisma, SQL, `fetch` o `process.env`. No es una convención: es una condición comprobada.
 *
 * ## Y lo que importa, lo importa entero
 *
 * `PlatformModule` y `PlatformAccessModule` exportan los servicios que el asistente consulta.
 * Reutilizarlos —en vez de escribir consultas propias— es lo que hace que el asistente no
 * pueda ver más que el panel: si mañana se estrecha lo que devuelve una de esas consultas, se
 * estrecha también para él, sin que nadie tenga que acordarse.
 */
@Module({
  imports: [LlmModule, PlatformModule, PlatformAccessModule],
  controllers: [PlatformAssistantController],
  providers: [PlatformAssistantService, AssistantToolRunner],
})
export class PlatformAssistantModule {}
