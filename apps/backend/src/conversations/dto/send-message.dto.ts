import { IsString, MaxLength, MinLength } from 'class-validator';

/** Límite de cordura: un turno de chat no es un canal de carga de documentos. */
const MAX_MESSAGE_LENGTH = 8000;

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_LENGTH)
  content!: string;
}
