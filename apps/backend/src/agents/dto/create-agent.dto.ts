import { AgentArea } from '@businessbrain/database';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * La forma EXTERNA de la petición. La validación semántica de `capabilities`, `tools`,
 * `memoryConfig` y `guardrails` no vive aquí sino en el dominio
 * (`agent-configuration.ts`), que es quien sabe qué herramientas existen y qué permisos
 * admite cada una. Aquí solo se comprueba que llega el tipo básico correcto.
 */
export class CreateAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEnum(AgentArea)
  area?: AgentArea;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  systemPrompt!: string;

  @IsOptional()
  @IsString()
  llmProfileId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsArray()
  capabilities?: unknown[];

  @IsOptional()
  @IsArray()
  tools?: unknown[];

  @IsOptional()
  @IsObject()
  memoryConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  guardrails?: Record<string, unknown>;

  /** Alcance de conocimiento. Se valida contra la organización activa antes de vincularlo. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeCollectionIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
