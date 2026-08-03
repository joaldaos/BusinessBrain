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
 * Todo opcional: una actualización parcial es legítima. Lo que NO es parcial es la
 * validación — el servicio revalida la configuración entera contra el estado resultante,
 * porque una actualización de un solo campo puede dejar al agente en un estado imposible.
 */
export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(AgentArea)
  area?: AgentArea;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  systemPrompt?: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeCollectionIds?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
