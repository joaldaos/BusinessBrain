import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  AutomationStatus,
  AutomationTriggerType,
} from '@businessbrain/database';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * Contratos HTTP de las automatizaciones — fase 6.
 *
 * Aquí solo se valida la FORMA del transporte. Que las acciones pertenezcan al catálogo
 * cerrado y que la expresión de calendario sea ejecutable lo decide el dominio
 * (`automation-plan.ts`): un `class-validator` sobre un `Json` no puede expresar esa regla, y
 * dejarla aquí la sacaría del único sitio donde se puede probar sin levantar la aplicación.
 */
export class CreateAutomationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  /** `{ cron, timezone }` para SCHEDULE. El dominio lo valida. */
  @IsObject()
  @IsOptional()
  triggerConfig?: Record<string, unknown>;

  /** Pasos ordenados. El catálogo cerrado se aplica en el dominio. */
  @IsArray()
  actions!: unknown[];
}

export class UpdateAutomationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsEnum(AutomationStatus)
  @IsOptional()
  status?: AutomationStatus;

  @IsEnum(AutomationTriggerType)
  @IsOptional()
  triggerType?: AutomationTriggerType;

  @IsObject()
  @IsOptional()
  triggerConfig?: Record<string, unknown>;

  @IsArray()
  @IsOptional()
  actions?: unknown[];
}

export class ListAutomationsQueryDto extends PaginationQueryDto {
  @IsEnum(AutomationStatus)
  @IsOptional()
  status?: AutomationStatus;
}
