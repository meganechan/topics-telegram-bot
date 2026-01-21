import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { RequireScope } from "../../common/decorators/api-scope.decorator";
import { ApiKeyScope } from "./schemas/api-key.schema";
import { TicketService } from "../ticket/ticket.service";
import { MessagesService } from "../messages/messages.service";
import { TopicsService } from "../topics/topics.service";
import { UsersService } from "../users/users.service";
import { GroupsService } from "../groups/groups.service";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { UpdateTicketDto } from "./dto/update-ticket.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { MentionUserDto } from "./dto/mention-user.dto";
import { QueryTicketsDto } from "./dto/query-tickets.dto";
import { BotService } from "../bot/bot.service";
import { TicketStatus } from "../ticket/schemas/ticket.schema";

@Controller("api/v1")
@UseGuards(ApiKeyGuard)
export class ApiController {
  constructor(
    private readonly ticketService: TicketService,
    private readonly messagesService: MessagesService,
    private readonly topicsService: TopicsService,
    private readonly usersService: UsersService,
    private readonly groupsService: GroupsService,
    private readonly botService: BotService,
  ) {}

  // ==================== TICKETS ====================

  @Post("tickets")
  @RequireScope(ApiKeyScope.WRITE)
  async createTicket(@Body() createTicketDto: CreateTicketDto) {
    // Verify group exists
    const group = await this.groupsService.findByTelegramGroupId(
      createTicketDto.groupId,
    );
    if (!group) {
      throw new BadRequestException(
        `Group ${createTicketDto.groupId} not found`,
      );
    }

    // Create ticket
    const ticket = await this.ticketService.createTicket({
      title: createTicketDto.title,
      description: createTicketDto.description,
      groupId: createTicketDto.groupId,
      createdBy: createTicketDto.createdBy,
      priority: createTicketDto.priority,
      assignedTo: createTicketDto.assignedTo,
    });

    // Create forum topic
    const topicName = createTicketDto.title;
    const topicResult = await this.botService.createForumTopic(
      createTicketDto.groupId,
      topicName,
    );

    if (topicResult && topicResult.message_thread_id) {
      // Create topic in database
      await this.topicsService.createTopic({
        telegramTopicId: topicResult.message_thread_id,
        name: topicName,
        groupId: createTicketDto.groupId,
        ticketId: ticket.ticketId,
        createdBy: createTicketDto.createdBy,
        isPrimary: true,
      });

      // Add creator as participant
      await this.ticketService.addParticipant(
        ticket.ticketId,
        createTicketDto.createdBy,
      );

      // Send welcome message
      const welcomeMessage =
        `📋 Ticket: ${ticket.ticketId}\n` +
        `📝 หัวข้อ: ${ticket.title}\n` +
        (createTicketDto.description
          ? `📖 รายละเอียด: ${createTicketDto.description}\n`
          : "") +
        `\n🔗 สร้างผ่าน API`;

      await this.botService.sendMessageToTopic(
        createTicketDto.groupId,
        topicResult.message_thread_id,
        welcomeMessage,
      );
    }

    return {
      success: true,
      data: ticket,
    };
  }

  @Get("tickets")
  @RequireScope(ApiKeyScope.READ)
  async getTickets(@Query() query: QueryTicketsDto) {
    const filter: any = {};

    if (query.groupId) filter.groupId = query.groupId;
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.createdBy) filter.createdBy = query.createdBy;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;

    const tickets = await this.ticketService.findWithFilters(
      filter,
      query.limit,
      query.offset,
      query.sortBy,
      query.sortOrder,
    );

    return {
      success: true,
      data: tickets,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  @Get("tickets/:ticketId")
  @RequireScope(ApiKeyScope.READ)
  async getTicket(@Param("ticketId") ticketId: string) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    return {
      success: true,
      data: ticket,
    };
  }

  @Put("tickets/:ticketId")
  @RequireScope(ApiKeyScope.WRITE)
  async updateTicket(
    @Param("ticketId") ticketId: string,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    const updatedTicket = await this.ticketService.updateTicket(
      ticketId,
      updateTicketDto,
    );

    return {
      success: true,
      data: updatedTicket,
    };
  }

  @Post("tickets/:ticketId/close")
  @RequireScope(ApiKeyScope.WRITE)
  @HttpCode(HttpStatus.OK)
  async closeTicket(@Param("ticketId") ticketId: string) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException("Ticket is already closed");
    }

    // Close ticket
    const closedTicket = await this.ticketService.closeTicket(ticketId);

    // Close all topics
    for (const topic of ticket.topics) {
      try {
        await this.botService.closeForumTopic(topic.groupId, topic.topicId);
        await this.topicsService.deactivateTopic(topic.topicId, topic.groupId);
      } catch (error) {
        // Continue even if topic close fails
      }
    }

    return {
      success: true,
      data: closedTicket,
    };
  }

  // ==================== MESSAGES ====================

  @Post("tickets/:ticketId/messages")
  @RequireScope(ApiKeyScope.WRITE)
  async sendMessage(
    @Param("ticketId") ticketId: string,
    @Body() sendMessageDto: SendMessageDto,
  ) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException("Cannot send message to closed ticket");
    }

    // Find primary topic
    const primaryTopic = ticket.topics.find((t) => t.isPrimary);
    if (!primaryTopic) {
      throw new BadRequestException("Ticket has no primary topic");
    }

    // Send message to topic
    const options: any = {};
    if (sendMessageDto.replyToMessageId) {
      options.reply_to_message_id = sendMessageDto.replyToMessageId;
    }

    const sentMessage = await this.botService.sendMessageToTopic(
      primaryTopic.groupId,
      primaryTopic.topicId,
      `📨 [API] ${sendMessageDto.text}`,
      options,
    );

    // Update ticket message count
    await this.ticketService.incrementMessageCount(ticketId);

    return {
      success: true,
      data: {
        messageId: sentMessage.message_id,
        text: sendMessageDto.text,
        topicId: primaryTopic.topicId,
        groupId: primaryTopic.groupId,
      },
    };
  }

  @Get("tickets/:ticketId/messages")
  @RequireScope(ApiKeyScope.READ)
  async getMessages(
    @Param("ticketId") ticketId: string,
    @Query("limit") limit: number = 50,
  ) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    const messages = await this.messagesService.findByTicketId(ticketId, limit);

    return {
      success: true,
      data: messages,
    };
  }

  // ==================== MENTION ====================

  @Post("tickets/:ticketId/mention")
  @RequireScope(ApiKeyScope.WRITE)
  async mentionUser(
    @Param("ticketId") ticketId: string,
    @Body() mentionUserDto: MentionUserDto,
  ) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException("Cannot mention user in closed ticket");
    }

    // Find user
    const targetUser = await this.usersService.findByUsername(
      mentionUserDto.username,
    );
    if (!targetUser) {
      throw new NotFoundException(`User @${mentionUserDto.username} not found`);
    }

    // Check if user is already participant
    if (ticket.participants.includes(targetUser.telegramId)) {
      throw new BadRequestException(
        `User @${mentionUserDto.username} is already in this ticket`,
      );
    }

    // Get user's default group
    const userGroupId = await this.usersService.getUserDefaultGroup(
      targetUser.telegramId,
    );
    const targetGroupId = userGroupId || ticket.groupId;

    // Create topic for mentioned user
    const topicName = `👤 ${targetUser.firstName || mentionUserDto.username} - ${ticket.ticketId}`;
    const topicResult = await this.botService.createForumTopic(
      targetGroupId,
      topicName,
      0x6fb9f0,
    );

    if (!topicResult.success) {
      throw new BadRequestException("Failed to create topic for user");
    }

    // Save topic in database
    await this.topicsService.createTopic({
      telegramTopicId: topicResult.message_thread_id,
      groupId: targetGroupId,
      name: topicName,
      ticketId: ticket.ticketId,
      createdBy: targetUser.telegramId,
    });

    // Link with primary topic
    const primaryTopic = ticket.topics.find((t) => t.isPrimary);
    if (primaryTopic) {
      await this.topicsService.linkTopics(
        primaryTopic.topicId,
        topicResult.message_thread_id,
        targetGroupId,
      );
    }

    // Add user as participant
    await this.ticketService.addParticipant(
      ticket.ticketId,
      targetUser.telegramId,
    );

    // Send initial message
    const initialMessage =
      `🎯 **${targetUser.firstName || mentionUserDto.username}** ได้รับการเชิญเข้าร่วม Ticket\n\n` +
      `🎫 Ticket: ${ticket.ticketId}\n` +
      `📝 หัวข้อ: ${ticket.title}\n` +
      (mentionUserDto.message
        ? `\n💬 ข้อความ: ${mentionUserDto.message}\n`
        : "") +
      `\n🔗 สร้างผ่าน API`;

    await this.botService.sendMessageToTopic(
      targetGroupId,
      topicResult.message_thread_id,
      initialMessage,
    );

    return {
      success: true,
      data: {
        username: mentionUserDto.username,
        topicId: topicResult.message_thread_id,
        groupId: targetGroupId,
      },
    };
  }

  // ==================== STATS ====================

  @Get("tickets/:ticketId/stats")
  @RequireScope(ApiKeyScope.READ)
  async getTicketStats(@Param("ticketId") ticketId: string) {
    const ticket = await this.ticketService.findByTicketId(ticketId);
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }

    const messageStats = await this.messagesService.getMessageStats(
      undefined,
      ticketId,
    );

    return {
      success: true,
      data: {
        ticketId: ticket.ticketId,
        status: ticket.status,
        totalMessages: ticket.totalMessages,
        totalTopics: ticket.totalTopics,
        participants: ticket.participants.length,
        messageStats,
        lastActivityAt: ticket.lastActivityAt,
        createdAt: (ticket as any).createdAt,
        closedAt: ticket.closedAt,
      },
    };
  }

  // ==================== GROUPS ====================

  @Get("groups")
  @RequireScope(ApiKeyScope.READ)
  async getGroups() {
    const groups = await this.groupsService.findAll();
    return {
      success: true,
      data: groups,
    };
  }

  @Get("groups/:groupId")
  @RequireScope(ApiKeyScope.READ)
  async getGroup(@Param("groupId") groupId: string) {
    const group = await this.groupsService.findByTelegramGroupId(groupId);
    if (!group) {
      throw new NotFoundException(`Group ${groupId} not found`);
    }

    return {
      success: true,
      data: group,
    };
  }

  // ==================== USERS ====================

  @Get("users")
  @RequireScope(ApiKeyScope.READ)
  async getUsers() {
    const users = await this.usersService.findAllActiveUsers([]);
    return {
      success: true,
      data: users,
    };
  }

  @Get("users/:telegramId")
  @RequireScope(ApiKeyScope.READ)
  async getUser(@Param("telegramId") telegramId: string) {
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      throw new NotFoundException(`User ${telegramId} not found`);
    }

    return {
      success: true,
      data: user,
    };
  }
}
