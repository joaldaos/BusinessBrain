import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global: casi todos los módulos de dominio necesitan PrismaService.
 * Evita repetir `imports: [PrismaModule]` en cada módulo de la app.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
