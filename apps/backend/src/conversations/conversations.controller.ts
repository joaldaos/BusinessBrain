import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { from, map, type Observable } from 'rxjs';
import { MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../common/guards/org-role.guard';
import { OrgRoles } from '../common/decorators/roles.decorator';
import { CurrentOrg } from '../common/decorators/current-org.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type {
  RequestOrganization,
  RequestUser,
} from '../common/types/authenticated-request';
import { ConversationsService } from './conversations.service';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { SendMessageUseCase } from './send-message.use-case';
import { StreamMessageUseCase } from './stream-message.use-case';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { RenameConversationDto } from './dto/rename-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { RateLimited } from '../common/decorators/rate-limited.decorator';

/**
 * Rutas con `:conversationId` (no `:id`) por el mismo motivo que en el Knowledge Engine:
 * `OrgRoleGuard` resuelve la organización activa desde `:id`/`:organizationId` o el header
 * `x-org-id`, así que aquí la organización siempre llega por el header.
 */
@Controller('conversations')
@UseGuards(OrgRoleGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly sendMessage: SendMessageUseCase,
    private readonly streamMessage: StreamMessageUseCase,
  ) {}

  @Post()
  @OrgRoles(MembershipRole.MEMBER)
  create(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateConversationDto,
  ) {
    return this.conversations.create({
      organizationId: org.id,
      userId: user.id,
      title: dto.title,
      agentId: dto.agentId,
    });
  }

  @Get()
  @OrgRoles(MembershipRole.VIEWER)
  list(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Query() page: PaginationQueryDto,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.conversations.listForUser({
      limit: page.limit,
      offset: page.offset,
      organizationId: org.id,
      userId: user.id,
      includeArchived: includeArchived === 'true',
    });
  }

  @Get(':conversationId')
  @OrgRoles(MembershipRole.VIEWER)
  findOne(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversations.findOne({
      organizationId: org.id,
      userId: user.id,
      conversationId,
    });
  }

  @Patch(':conversationId')
  @OrgRoles(MembershipRole.MEMBER)
  rename(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: RenameConversationDto,
  ) {
    return this.conversations.rename({
      organizationId: org.id,
      userId: user.id,
      conversationId,
      title: dto.title,
    });
  }

  @Post(':conversationId/archive')
  @OrgRoles(MembershipRole.MEMBER)
  archive(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
  ) {
    return this.conversations.archive({
      organizationId: org.id,
      userId: user.id,
      conversationId,
    });
  }

  /**
   * Envía un mensaje y devuelve la respuesta con sus citas. La comprensión y el
   * conocimiento se resuelven aguas arriba: este controlador no decide nada sobre ellos.
   */
  // Cada pregunta cuesta dinero en la cuenta del cliente. El límite es generoso: aquí el
  // peligro no es un atacante sino un bucle accidental o una pestaña que reintenta sola.
  @RateLimited('ask')
  @Post(':conversationId/messages')
  @OrgRoles(MembershipRole.MEMBER)
  send(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.sendMessage.execute({
      organizationId: org.id,
      userId: user.id,
      conversationId,
      content: dto.content,
    });
  }

  /**
   * Misma respuesta, entregada por fragmentos vía SSE. `@Sse` espera un `Observable`, así
   * que el flujo asíncrono del caso de uso se adapta aquí: el caso de uso no conoce Rx ni
   * el transporte, y el controlador no conoce el pipeline.
   *
   * El evento `context` (citas y comprensión) llega antes que el primer fragmento de texto.
   */
  @Sse(':conversationId/messages/stream')
  @OrgRoles(MembershipRole.MEMBER)
  stream(
    @CurrentOrg() org: RequestOrganization,
    @CurrentUser() user: RequestUser,
    @Param('conversationId') conversationId: string,
    @Query('content') content: string,
  ): Observable<MessageEvent> {
    const events = this.streamMessage.execute({
      organizationId: org.id,
      userId: user.id,
      conversationId,
      content,
    });

    return from(events).pipe(
      map((event) => ({ type: event.type, data: event })),
    );
  }
}
