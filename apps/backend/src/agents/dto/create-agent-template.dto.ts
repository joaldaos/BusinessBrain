import { AgentArea, AgentTemplateVisibility } from '@businessbrain/database';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Forma EXTERNA de la petición. Igual que en `CreateAgentDto`, la validación semántica de
 * `defaultCapabilities` y `defaultTools` no vive aquí sino en el dominio
 * (`agent-configuration.ts`), que es quien sabe qué herramientas existen y qué permiso
 * admite cada una. Aquí solo se comprueba que llega el tipo básico correcto.
 *
 * No hay campo `publisherOrgId`: una plantilla siempre nace atribuida a la organización
 * activa. Aceptarlo por petición permitiría publicar en nombre de otra.
 */
export class CreateAgentTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsEnum(AgentArea)
  area?: AgentArea;

  /**
   * `PUBLIC` se acepta como declaración de intención de cara al marketplace futuro, pero no
   * concede ningún alcance en la Fase 5: cross-org está cerrado por código.
   */
  @IsOptional()
  @IsEnum(AgentTemplateVisibility)
  visibility?: AgentTemplateVisibility;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  defaultSystemPrompt!: string;

  @IsOptional()
  @IsArray()
  defaultCapabilities?: unknown[];

  @IsOptional()
  @IsArray()
  defaultTools?: unknown[];
}
