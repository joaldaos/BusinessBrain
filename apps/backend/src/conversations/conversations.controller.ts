import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { SendMessageUseCase } from './send-message.use-case';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { RenameConversationDto } from './dto/rename-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

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
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.conversations.listForUser({
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
}
