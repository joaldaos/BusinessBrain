import { Injectable } from '@nestjs/common';
import type {
  ConnectorPort,
  ExtractedContent,
} from '../../domain/ports/connector.port';

/**
 * Forma mínima que este conector necesita de un archivo subido. Se declara localmente en vez
 * de depender del tipo ambiental `Express.Multer.File` porque `@types/multer` no está instalado
 * en este proyecto (multer llega como dependencia transitiva de `@nestjs/platform-express`,
 * sin sus tipos); esta interfaz cubre exactamente los campos que se usan.
 */
export interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface FileUploadConnectorInput {
  file: UploadedFilePayload;
}

/**
 * Único conector implementado en la subfase 2.1 (KNOWLEDGE_ENGINE_DESIGN.md §19). Un archivo
 * subido manualmente produce siempre exactamente un KnowledgeItem candidato.
 */
@Injectable()
export class FileUploadConnector implements ConnectorPort {
  readonly key = 'file_upload_v1';

  extract(input: FileUploadConnectorInput): Promise<ExtractedContent[]> {
    return Promise.resolve([
      {
        title: input.file.originalname,
        mimeType: input.file.mimetype,
        sizeBytes: input.file.size,
        rawContent: input.file.buffer,
      },
    ]);
  }
}
