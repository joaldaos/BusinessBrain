import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Lo que se puede ajustar al instalar. Deliberadamente NO se aceptan `capabilities` ni
 * `tools`: si la instalación pudiera ampliarlos, la plantilla dejaría de ser el contrato
 * de lo que se está concediendo y el catálogo perdería todo su valor como control. Para un
 * agente con otras capacidades existe `POST /agents`.
 */
export class InstallAgentTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

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

  /** El alcance de conocimiento se declara al instalar: nunca lo trae la plantilla. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeCollectionIds?: string[];
}
