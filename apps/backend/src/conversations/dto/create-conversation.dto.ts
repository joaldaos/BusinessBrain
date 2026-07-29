import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  /** Agente que atiende la conversación. Sin él, se usa el comportamiento por defecto. */
  @IsOptional()
  @IsString()
  agentId?: string;
}
