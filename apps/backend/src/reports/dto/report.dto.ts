import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ReportFormat } from '@businessbrain/database';

/**
 * Contratos HTTP de los informes — fase 6.
 *
 * Solo la FORMA del transporte. Que las secciones pertenezcan al catálogo cerrado y que sus
 * límites sean razonables lo decide el dominio (`report-template.ts`): un `class-validator`
 * sobre un `Json` no puede expresar esa regla, y dejarla aquí la sacaría del único sitio donde
 * se puede probar sin levantar la aplicación.
 */
export class CreateReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(ReportFormat)
  @IsOptional()
  format?: ReportFormat;

  /** `{ sections: [...] }`. El catálogo cerrado se aplica en el dominio. */
  @IsObject()
  template!: Record<string, unknown>;
}

export class UpdateReportDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsObject()
  @IsOptional()
  template?: Record<string, unknown>;
}
