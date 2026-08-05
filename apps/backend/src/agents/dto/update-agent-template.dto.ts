import { AgentArea, AgentTemplateVisibility } from '@businessbrain/database';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Todo opcional: se actualiza lo que llega. Los defaults se revalidan enteros de todos modos. */
export class UpdateAgentTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(AgentArea)
  area?: AgentArea;

  @IsOptional()
  @IsEnum(AgentTemplateVisibility)
  visibility?: AgentTemplateVisibility;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  defaultSystemPrompt?: string;

  @IsOptional()
  @IsArray()
  defaultCapabilities?: unknown[];

  @IsOptional()
  @IsArray()
  defaultTools?: unknown[];
}
