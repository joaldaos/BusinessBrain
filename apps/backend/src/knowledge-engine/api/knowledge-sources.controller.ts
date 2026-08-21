import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../../common/types/authenticated-request';
import { KnowledgeSourcesService } from '../application/knowledge-sources.service';
import { IngestFromSourceUseCase } from '../application/ingest-from-source.use-case';
import { CreateKnowledgeSourceDto } from '../dto/create-knowledge-source.dto';
import { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import type { UploadedFilePayload } from '../infrastructure/connectors/file-upload.connector';
import {
  acceptedExtensions,
  acceptedMimeTypes,
} from '../domain/document-formats';

/**
 * Tope por archivo.
 *
 * Sin él, una sola subida podría agotar la memoria del proceso. 25 MB cubre de sobra un
 * contrato, una propuesta o un manual en PDF —lo que sube una PYME— sin convertir la ruta en
 * una vía cómoda para saturar el servidor. El texto EXTRAÍDO tiene su propio tope aparte: un
 * PDF comprimido de pocos megas puede rendir muchísimo más texto del que ocupa.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Rutas con `:knowledgeSourceId` (no `:id`) a propósito: `OrgRoleGuard` resuelve la
 * organización activa desde `:id`/`:organizationId` o el header `x-org-id` (ver
 * `common/guards/org-role.guard.ts`) — aquí `:id` identificaría la fuente, no la organización,
 * así que la organización siempre se resuelve por el header `x-org-id`.
 */
@Controller('knowledge-sources')
@UseGuards(OrgRoleGuard)
export class KnowledgeSourcesController {
  constructor(
    private readonly knowledgeSourcesService: KnowledgeSourcesService,
    private readonly ingestFromSource: IngestFromSourceUseCase,
    private readonly connectorRegistry: ConnectorRegistry,
  ) {}

  @Post()
  @OrgRoles(MembershipRole.MEMBER)
  async create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateKnowledgeSourceDto,
  ) {
    return this.knowledgeSourcesService.create(org.id, user.id, dto);
  }

  @Get()
  async findAll(@CurrentOrg() org: RequestOrganization) {
    return this.knowledgeSourcesService.findAll(org.id);
  }

  /**
   * Qué formatos se admiten de verdad.
   *
   * Existe para que la pantalla NO tenga su propia lista: el selector prometía `.pdf` y
   * `.docx` cuando la normalización los rechazaba, y nadie lo detectó porque eran dos listas
   * distintas. Ahora sale de la misma fuente que valida.
   *
   * Declarada ANTES de `:knowledgeSourceId` a propósito: si no, la ruta con parámetro se la
   * comería y esto respondería "fuente no encontrada".
   */
  @Get('supported-formats')
  supportedFormats() {
    return {
      extensions: acceptedExtensions(),
      mimeTypes: acceptedMimeTypes(),
    };
  }

  @Get(':knowledgeSourceId')
  async findOne(
    @CurrentOrg() org: RequestOrganization,
    @Param('knowledgeSourceId') knowledgeSourceId: string,
  ) {
    return this.knowledgeSourcesService.findOne(org.id, knowledgeSourceId);
  }

  @Post(':knowledgeSourceId/sync')
  @OrgRoles(MembershipRole.MEMBER)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async sync(
    @CurrentOrg() org: RequestOrganization,
    @Param('knowledgeSourceId') knowledgeSourceId: string,
    @UploadedFile() file: UploadedFilePayload,
  ) {
    // Qué necesita la sincronización lo decide el CONECTOR, no la ruta. Uno que recibe
    // contenido (`PUSH`) exige el archivo; uno que va a buscarlo (`PULL`) no necesita que
    // nadie suba nada — y por eso puede ejecutarse sin persona delante, que es lo que
    // habilita la sincronización programada.
    const source = await this.knowledgeSourcesService.findOne(
      org.id,
      knowledgeSourceId,
    );
    const connector = this.connectorRegistry.get(source.connectorKey);

    if (connector.acquisition === 'PUSH' && !file) {
      throw new BadRequestException('Elige un archivo para subirlo.');
    }

    // El tipo se comprueba ANTES de aceptar el trabajo: rechazar aquí da un error inmediato y
    // claro en la pantalla, en vez de una ingesta que termina "con 1 error" y obliga a ir a
    // buscar el motivo. La comprobación de fondo —la que mira el contenido real— sigue
    // estando en la normalización, que es por donde entran también Drive y Gmail.
    if (
      file &&
      !acceptedMimeTypes().includes(file.mimetype.split(';')[0].trim())
    ) {
      throw new BadRequestException(
        `No podemos leer este tipo de archivo. Admitimos ${acceptedExtensions().join(', ')}.`,
      );
    }

    return this.ingestFromSource.execute({
      organizationId: org.id,
      knowledgeSourceId,
      connectorInput: file ? { file } : {},
    });
  }
}
