import {
  Injectable,
  OnModuleInit,
  Logger,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as TelegramBot from "node-telegram-bot-api";
import { UsersService } from "../users/users.service";
import { GroupsService } from "../groups/groups.service";
import { TicketService } from "../ticket/ticket.service";
import { TopicsService } from "../topics/topics.service";
import { AttachmentsService } from "../attachments/attachments.service";
import { MessagesService } from "../messages/messages.service";
import { HooksService } from "../hooks/hooks.service";
import { HookEvent } from "../hooks/schemas/hook.schema";
import * as fs from "fs/promises";
import * as https from "https";
import * as path from "path";

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bot: TelegramBot;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private groupsService: GroupsService,
    private ticketService: TicketService,
    private topicsService: TopicsService,
    private attachmentsService: AttachmentsService,
    private messagesService: MessagesService,
    @Inject(forwardRef(() => HooksService)) private hooksService: HooksService,
  ) {
    const botToken = this.configService.get<string>("telegram.botToken");
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required");
    }

    // Disable Telegram HTTP request logging
    process.env.NTBA_FIX_319 = "1";
    process.env.NTBA_FIX_350 = "1";

    this.bot = new TelegramBot(botToken, {
      polling: false,
    });
  }

  async onModuleInit() {
    this.setupCommands();

    // Setup webhook in background to not block app startup
    this.setupWebhook().catch((err) => {
      this.logger.error("Failed to setup webhook:", err.message);
    });

    this.logger.log("Telegram bot started successfully");

    // Schedule automatic topic sync every 6 hours
    this.scheduleTopicSync();
  }

  async processWebhookUpdate(update: any) {
    try {
      this.bot.processUpdate(update);
    } catch (error) {
      this.logger.error(
        "Error processing webhook update in BotService:",
        error,
      );
      throw error;
    }
  }

  private async setupWebhook() {
    try {
      const webhookUrl = this.configService.get<string>("telegram.webhookUrl");
      if (!webhookUrl) {
        this.logger.warn(
          "TELEGRAM_WEBHOOK_URL not configured, skipping webhook setup",
        );
        return;
      }

      const fullWebhookUrl = `${webhookUrl}/webhook/telegram`;
      await this.bot.setWebHook(fullWebhookUrl);
      this.logger.log(`Webhook configured successfully: ${fullWebhookUrl}`);
    } catch (error) {
      this.logger.error("Failed to setup webhook:", error);
      throw error;
    }
  }

  async removeWebhook() {
    try {
      await this.bot.deleteWebHook();
      this.logger.log("Webhook removed successfully");
    } catch (error) {
      this.logger.error("Failed to remove webhook:", error);
      throw error;
    }
  }

  async getWebhookInfo() {
    try {
      const info = await this.bot.getWebHookInfo();
      this.logger.log("Current webhook info:", info);
      return info;
    } catch (error) {
      this.logger.error("Failed to get webhook info:", error);
      throw error;
    }
  }

  private scheduleTopicSync() {
    // Run topic sync every 6 hours (21600000 ms)
    setInterval(async () => {
      this.logger.log(
        `[${new Date().toISOString()}] 🕐 Running scheduled topic sync...`,
      );
      try {
        await this.syncTopicsWithTelegram();
      } catch (error) {
        this.logger.error(
          `[${new Date().toISOString()}] ❌ Scheduled topic sync failed:`,
          error,
        );
      }
    }, 21600000);

    this.logger.log(
      `[${new Date().toISOString()}] 📅 Scheduled topic sync every 6 hours`,
    );
  }

  // Network resilience wrapper for Telegram API calls
  private async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000,
    operationName: string = "Telegram API",
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        // ตรวจสอบว่าเป็น network error ที่ควร retry หรือไม่
        const shouldRetry =
          error.code === "ECONNRESET" ||
          error.code === "ECONNREFUSED" ||
          error.code === "ETIMEDOUT" ||
          error.code === "EFATAL" ||
          (error.response && error.response.status >= 500);

        if (!shouldRetry || attempt === maxRetries) {
          this.logger.error(
            `[${new Date().toISOString()}] ❌ ${operationName} failed permanently after ${attempt} attempts:`,
            error,
          );
          throw lastError;
        }

        const waitTime = delay * Math.pow(2, attempt - 1); // Exponential backoff
        this.logger.warn(
          `[${new Date().toISOString()}] ⚠️ ${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${waitTime}ms...`,
          error.message,
        );

        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    throw lastError;
  }

  private logApiCall(method: string, params?: string): void {
    this.logger.debug(
      `[${new Date().toISOString()}] API Call: ${method}${params ? ` - ${params}` : ""}`,
    );
  }

  private logApiResponse(method: string, duration: number, result?: any): void {
    const resultInfo = result
      ? ` - ${JSON.stringify(result).substring(0, 100)}${JSON.stringify(result).length > 100 ? "..." : ""}`
      : "";
    this.logger.debug(
      `[${new Date().toISOString()}] API Response: ${method} - Duration: ${duration}ms${resultInfo}`,
    );
  }

  private logApiError(method: string, error: any): void {
    this.logger.error(
      `[${new Date().toISOString()}] API Error: ${method} -`,
      error,
    );
  }

  async createForumTopic(
    chatId: string,
    name: string,
    iconColor?: number,
    iconCustomEmojiId?: string,
  ) {
    const startTime = Date.now();
    try {
      const apiParams: any = {
        chat_id: chatId,
        name,
      };

      if (iconColor) {
        apiParams.icon_color = iconColor as any;
      }

      if (iconCustomEmojiId) {
        apiParams.icon_custom_emoji_id = iconCustomEmojiId;
      }

      this.logger.log(
        `[${new Date().toISOString()}] API Call: createForumTopic - chatId: ${chatId}, name: ${name}`,
      );

      // เช็ค bot permissions ก่อนสร้าง topic
      try {
        const chat = await this.bot.getChat(chatId);
        this.logger.log(`[${new Date().toISOString()}] Target chat info:`, {
          id: chat.id,
          type: chat.type,
          title: chat.title,
          is_forum: (chat as any).is_forum,
        });

        const botMember = await this.bot.getChatMember(
          chatId,
          (await this.bot.getMe()).id,
        );
        this.logger.log(`[${new Date().toISOString()}] Bot permissions:`, {
          status: botMember.status,
          can_manage_topics: (botMember as any).can_manage_topics,
          can_delete_messages: (botMember as any).can_delete_messages,
          can_restrict_members: (botMember as any).can_restrict_members,
        });

        if (chat.type !== "supergroup") {
          throw new Error(`Cannot create topics in chat type: ${chat.type}`);
        }

        if (!(chat as any).is_forum) {
          //throw new Error('Target chat does not support forum topics');
        }

        if (botMember.status !== "administrator") {
          throw new Error(
            `Bot status: ${botMember.status} - requires administrator privileges`,
          );
        }
      } catch (permError) {
        this.logger.error(
          `[${new Date().toISOString()}] Permission check failed:`,
          permError,
        );
        throw permError;
      }

      // Note: createForumTopic might not be available in node-telegram-bot-api
      // Use the _request method to make a raw API call
      const result = await (this.bot as any)._request("createForumTopic", {
        form: apiParams,
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${new Date().toISOString()}] API Response: createForumTopic - Duration: ${duration}ms, Success: true`,
      );
      this.logger.log(
        `[${new Date().toISOString()}] Topic created - ID: ${result.message_thread_id}`,
      );

      return {
        success: true,
        message_thread_id: result.message_thread_id,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[${new Date().toISOString()}] API Error: createForumTopic - Duration: ${duration}ms`,
      );
      this.logger.error(`[${new Date().toISOString()}] Error details:`, {
        message: error.message,
        code: error.code,
        response: error.response?.body || error.response,
      });

      return {
        success: false,
        error: error.message || "Unknown error",
        message_thread_id: null,
      };
    }
  }

  async closeForumTopic(chatId: string, messageThreadId: number) {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] API Call: closeForumTopic - chatId: ${chatId}, messageThreadId: ${messageThreadId}`,
      );
      const startTime = Date.now();

      // Note: closeForumTopic might not be available in node-telegram-bot-api
      const result = await (this.bot as any)._request("closeForumTopic", {
        form: {
          chat_id: chatId,
          message_thread_id: messageThreadId,
        },
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${new Date().toISOString()}] API Response: closeForumTopic - Duration: ${duration}ms, Success: ${!!result.ok}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] API Error: closeForumTopic -`,
        error,
      );
      throw error;
    }
  }

  async deleteForumTopic(chatId: string, messageThreadId: number) {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] API Call: deleteForumTopic - chatId: ${chatId}, messageThreadId: ${messageThreadId}`,
      );
      const startTime = Date.now();

      // Use deleteForumTopic API
      const result = await (this.bot as any)._request("deleteForumTopic", {
        form: {
          chat_id: chatId,
          message_thread_id: messageThreadId,
        },
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${new Date().toISOString()}] API Response: deleteForumTopic - Duration: ${duration}ms, Success: ${!!result.ok}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] API Error: deleteForumTopic -`,
        error,
      );
      throw error;
    }
  }

  async sendMessageToTopic(
    chatId: string,
    messageThreadId: number,
    text: string,
    options?: any,
  ) {
    try {
      const sendOptions: any = {
        message_thread_id: messageThreadId,
        ...options,
      };

      // Explicitly remove parse_mode to avoid markdown parsing issues
      delete sendOptions.parse_mode;

      this.logger.log(
        `[${new Date().toISOString()}] API Call: sendMessage - chatId: ${chatId}, messageThreadId: ${messageThreadId}`,
      );
      this.logger.log(
        "Debug sendOptions before sending:",
        JSON.stringify(sendOptions, null, 2),
      );
      this.logger.log(
        "Debug text content type:",
        typeof text,
        "length:",
        text.length,
        "preview:",
        text.substring(0, 100) + (text.length > 100 ? "..." : ""),
      );

      const startTime = Date.now();
      const result = await this.withRetry(
        () => this.bot.sendMessage(chatId, text, sendOptions),
        3,
        1000,
        "sendMessage",
      );
      const duration = Date.now() - startTime;

      this.logger.log(
        `[${new Date().toISOString()}] API Response: sendMessage - Duration: ${duration}ms, MessageId: ${result.message_id}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] API Error: sendMessage -`,
        error,
      );
      throw error;
    }
  }

  async checkBotPermissions(
    chatId: string,
  ): Promise<{ isAdmin: boolean; canManageTopics: boolean }> {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] API Call: getMe & getChatMember - chatId: ${chatId}`,
      );
      const startTime = Date.now();

      const me = await this.bot.getMe();
      const botInfo = await this.bot.getChatMember(chatId, me.id);

      const duration = Date.now() - startTime;
      const isAdmin = botInfo.status === "administrator";

      let canManageTopics = false;
      if (isAdmin && "can_manage_topics" in botInfo) {
        canManageTopics = (botInfo as any).can_manage_topics === true;
      }

      this.logger.log(
        `[${new Date().toISOString()}] API Response: checkBotPermissions - Duration: ${duration}ms, isAdmin: ${isAdmin}, canManageTopics: ${canManageTopics}`,
      );

      return { isAdmin, canManageTopics };
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] API Error: checkBotPermissions -`,
        error,
      );
      return { isAdmin: false, canManageTopics: false };
    }
  }

  private setupCommands() {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/ct(.*)/, this.handleCreateTicket.bind(this));
    this.bot.onText(/\/cc/, this.handleCloseTicket.bind(this));
    this.bot.onText(/\/mt(.*)/, this.handleMention.bind(this));
    this.bot.onText(/\/lk(.*)/, this.handleLinkTopic.bind(this));
    this.bot.onText(/\/ul(.*)/, this.handleUnlinkTopic.bind(this));
    this.bot.onText(/\/st/, this.handleSyncTopics.bind(this));
    this.bot.onText(/\/archive(.*)/, this.handleArchive.bind(this));

    // Debug commands
    this.bot.onText(/\/debug_sync/, this.handleDebugSync.bind(this));
    this.bot.onText(/\/debug_clear/, this.handleDebugClear.bind(this));

    this.bot.on("callback_query", this.handleCallbackQuery.bind(this));
    this.bot.on("my_chat_member", this.handleChatMemberUpdate.bind(this));
    this.bot.on("message", this.handleMessage.bind(this));
  }

  private async handleCallbackQuery(callbackQuery: TelegramBot.CallbackQuery) {
    const data = callbackQuery.data;

    if (data?.startsWith("mention:")) {
      if (data === "mention:cancel") {
        await this.handleMentionCancel(callbackQuery);
      } else {
        const username = data.replace("mention:", "");
        await this.handleMentionCallback(callbackQuery, username);
      }
    } else if (data?.startsWith("mention_action:")) {
      await this.handleMentionActionCallback(callbackQuery, data);
    } else if (data?.startsWith("unlink:")) {
      await this.handleUnlinkCallback(callbackQuery, data);
    } else if (data?.startsWith("user_not_found:")) {
      await this.handleUserNotFoundCallback(callbackQuery, data);
    }
  }

  private async handleMentionActionCallback(
    callbackQuery: TelegramBot.CallbackQuery,
    data: string,
  ) {
    try {
      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;

      if (!messageThreadId || !chat) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ข้อมูลไม่ครบถ้วน",
        });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot
          .deleteMessage(
            callbackQuery.message.chat.id,
            callbackQuery.message.message_id,
          )
          .catch(() => {});
      }

      if (data === "mention_action:show_users") {
        await this.showUserSelectionMenu(
          message,
          messageThreadId,
          chat.id.toString(),
        );
      }
    } catch (error) {
      this.logger.error("Error handling mention action callback:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async handleUnlinkCallback(
    callbackQuery: TelegramBot.CallbackQuery,
    data: string,
  ) {
    try {
      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;
      const user = callbackQuery.from;

      if (!messageThreadId || !chat || !user) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ข้อมูลไม่ครบถ้วน",
        });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot
          .deleteMessage(
            callbackQuery.message.chat.id,
            callbackQuery.message.message_id,
          )
          .catch(() => {});
      }

      const targetTopicId = parseInt(data.replace("unlink:", ""));
      if (isNaN(targetTopicId)) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ Topic ID ไม่ถูกต้อง",
        });
        return;
      }

      // ยกเลิกการเชื่อมโยง
      await this.topicsService.unlinkTopics(
        messageThreadId,
        targetTopicId,
        chat.id.toString(),
      );

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔓 **ยกเลิกการเชื่อมโยง Topic**\n\n` +
        `📋 ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความจะไม่ถูกส่งไป Topic ${targetTopicId} อีกต่อไป`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        sourceMessage,
      );

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔓 **การเชื่อมโยงถูกยกเลิก**\n\n` +
        `📋 การเชื่อมโยงกับ Topic ${messageThreadId} ถูกยกเลิกแล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความจาก Topic ${messageThreadId} จะไม่ถูกส่งมาอีกต่อไป`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        targetTopicId,
        targetMessage,
      );

      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: `✅ ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} สำเร็จ`,
      });
    } catch (error) {
      this.logger.error("Error handling unlink callback:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async handleMentionCallback(
    callbackQuery: TelegramBot.CallbackQuery,
    username: string,
  ) {
    try {
      // Delete the original message
      if (callbackQuery.message) {
        await this.bot
          .deleteMessage(
            callbackQuery.message.chat.id,
            callbackQuery.message.message_id,
          )
          .catch(() => {});
      }

      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;
      const user = callbackQuery.from;

      if (!messageThreadId || !chat || !user) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ข้อมูลไม่ครบถ้วน",
        });
        return;
      }

      // Check topic and ticket
      const topic = await this.topicsService.findByTelegramTopicId(
        messageThreadId,
        chat.id.toString(),
      );
      if (!topic || !topic.ticketId) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้",
        });
        return;
      }

      const ticket = await this.ticketService.findByTicketId(topic.ticketId);
      if (!ticket) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ไม่พบข้อมูล Ticket",
        });
        return;
      }

      if (ticket.status === "closed") {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ไม่สามารถเชิญคนเข้า Ticket ที่ปิดแล้ว",
        });
        return;
      }

      // Find user in system
      const targetUser = await this.usersService.findByUsername(username);
      if (!targetUser) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: `❌ ไม่พบ User: ${username}`,
        });
        return;
      }

      // Check if user is already in ticket
      const topicTicket = topic.ticketId
        ? await this.ticketService.findByTicketId(topic.ticketId)
        : null;
      if (
        topicTicket &&
        topicTicket.participants.includes(targetUser.telegramId)
      ) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: `ℹ️ ${username} อยู่ใน Ticket นี้แล้ว`,
        });
        return;
      }

      // หา group ที่ User B pair ไว้
      const userBGroupId = await this.usersService.getUserDefaultGroup(
        targetUser.telegramId,
      );
      const targetGroupId = userBGroupId || chat.id.toString(); // fallback ไปกลุ่มปัจจุบันถ้าไม่ได้ pair

      // สร้าง topic ใหม่สำหรับ user ที่ถูก mention ในกลุ่มที่เขา pair ไว้
      const newTopicName = `👤 ${targetUser.firstName || username} - ${topicTicket?.ticketId || "UNKNOWN"}`;
      const newTopicResult = await this.createForumTopic(
        targetGroupId,
        newTopicName,
        0x6fb9f0, // Light blue color
      );

      if (!newTopicResult.success) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: `❌ ไม่สามารถสร้าง Topic สำหรับ @${username} ได้`,
        });
        return;
      }

      // บันทึก topic ใหม่ในฐานข้อมูล (สร้างโดย user ที่ถูก mention)
      const newTopic = await this.topicsService.createTopic({
        telegramTopicId: newTopicResult.message_thread_id,
        groupId: targetGroupId, // แก้ไข Critical Bug: ใช้ targetGroupId แทน chat.id
        name: newTopicName,
        ticketId: topicTicket?.ticketId,
        createdBy: targetUser.telegramId, // สร้างโดย user ที่ถูก mention (userB)
      });

      // Debug logging (Topic Saved)
      this.logger.log(`[${new Date().toISOString()}] 💾 TOPIC SAVED:`);
      this.logger.log(
        `  - Telegram topicId: ${newTopicResult.message_thread_id}`,
      );
      this.logger.log(`  - Database groupId: ${targetGroupId}`);
      this.logger.log(`  - Linked to original topic: ${messageThreadId}`);

      // เชื่อมโยง topic เดิมกับ topic ใหม่
      await this.topicsService.linkTopics(
        messageThreadId,
        newTopicResult.message_thread_id,
        targetGroupId,
      );

      // เพิ่ม user เป็น participant ใน ticket
      if (topic.ticketId) {
        await this.ticketService.addParticipant(
          topic.ticketId,
          targetUser.telegramId,
        );
      }

      // ส่งข้อความแจ้งใน topic เดิม
      const originalTopicMessage =
        `✅ สร้าง Topic สำหรับ @${username} แล้ว\n` +
        `🎫 Ticket: ${topicTicket?.ticketId}\n` +
        `📝 หัวข้อ: ${topicTicket?.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n` +
        `🔗 Topic ของ @${username}: "${newTopicName}"\n\n` +
        `💬 ข้อความจะถูก sync ระหว่าง topics อัตโนมัติ`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        originalTopicMessage,
      );

      // ส่งข้อความแจ้งใน topic ใหม่
      const initialMessage =
        `🎯 **${targetUser.firstName || username}** ได้รับการเชิญเข้าร่วม Ticket\n\n` +
        `🎫 Ticket: ${topicTicket?.ticketId}\n` +
        `📝 หัวข้อ: ${topicTicket?.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n\n` +
        `💬 นี่คือพื้นที่สนทนาส่วนตัวสำหรับ ${targetUser.firstName || username}\n` +
        `🔗 ข้อความจะถูก sync กับ Topic หลักอัตโนมัติ\n\n` +
        `📞 @${username} กรุณาส่งข้อความเพื่อเริ่มการสนทนา`;

      try {
        await this.sendMessageToTopic(
          chat.id.toString(),
          newTopicResult.message_thread_id,
          initialMessage,
        );
      } catch (sendError) {
        // If topic doesn't exist, delete the topic and all its relations
        if (
          sendError.message &&
          sendError.message.includes("message thread not found")
        ) {
          this.logger.warn(
            `[${new Date().toISOString()}] 🧹 Topic ${newTopicResult.message_thread_id} not found - deleting from database`,
          );
          await this.topicsService.deleteTopicAndRelations(
            newTopicResult.message_thread_id,
            chat.id.toString(),
          );
        } else {
          this.logger.error(
            `[${new Date().toISOString()}] ❌ Failed to send initial message to topic ${newTopicResult.message_thread_id}:`,
            sendError.message,
          );
        }

        // Don't throw - let the mention process continue
        this.logger.log(
          `[${new Date().toISOString()}] ⚠️ Mention created but initial message failed - topic may have been deleted`,
        );
      }

      // ส่งการแจ้งเตือนให้ user ที่ถูก mention (ถ้าเป็นไปได้)
      try {
        await this.notifyMentionedUser(
          targetUser,
          topicTicket,
          newTopicResult.message_thread_id,
          chat.id.toString(),
          user.first_name,
        );
      } catch (error) {
        this.logger.log(
          `Could not send direct notification to user ${username}:`,
          error.message,
        );
      }

      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: `✅ เชิญ ${username} สำเร็จ`,
      });
    } catch (error) {
      this.logger.error("Error handling mention callback:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async handleMentionCancel(callbackQuery: TelegramBot.CallbackQuery) {
    try {
      // Delete message
      if (callbackQuery.message) {
        await this.bot
          .deleteMessage(
            callbackQuery.message.chat.id,
            callbackQuery.message.message_id,
          )
          .catch(() => {});
      }
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "ยกเลิกการเชิญผู้ใช้",
      });
    } catch (error) {
      this.logger.error("Error handling mention cancel:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async handleStart(msg: TelegramBot.Message, match: RegExpExecArray) {
    this.logger.log("handleStart", msg);

    if (msg.chat?.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "👋 สวัสดี! ฉันเป็น Telegram Ticket Support Bot\n\n" +
          "🎫 เพิ่มฉันเข้ากลุ่มและให้สิทธิ์ Admin เพื่อเริ่มใช้งาน\n" +
          "📋 ใช้คำสั่ง /ct เพื่อสร้าง ticket ใหม่",
      );
    } else {
      const user = msg.from;
      const chat = msg.chat;

      if (user && chat) {
        // สร้างหรือค้นหา user
        await this.usersService.findOrCreateUser({
          telegramId: user.id.toString(),
          username: user.username || user.first_name || "Unknown",
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot,
          languageCode: user.language_code,
        });

        // Pair user กับกลุ่มปัจจุบัน
        await this.usersService.pairUserWithGroup(
          user.id.toString(),
          chat.id.toString(),
        );

        await this.bot.sendMessage(
          msg.chat.id,
          `✅ Bot พร้อมใช้งานในกลุ่มนี้แล้ว!\n\n` +
            `👤 ${user.first_name} ได้ถูก pair กับกลุ่มนี้เรียบร้อยแล้ว\n` +
            `🎫 ใช้ /ct <หัวข้อ> [รายละเอียด] เพื่อสร้าง ticket\n` +
            `🔗 เมื่อมีคนเรียกคุณ topic จะถูกสร้างในกลุ่มนี้`,
        );
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "✅ Bot พร้อมใช้งานในกลุ่มนี้แล้ว!\n\n" +
            "🎫 ใช้ /ct <หัวข้อ> [รายละเอียด] เพื่อสร้าง ticket",
        );
      }
    }
  }

  private async handleCreateTicket(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const text = msg.text || "";
    const args = text.split(" ").slice(1);

    if (args.length === 0) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ กรุณาระบุหัวข้อ ticket\n\n" +
          "📝 ตัวอย่าง: /ct ปัญหาระบบล็อกอิน ไม่สามารถเข้าใช้งานได้",
      );
      return;
    }

    // แยก title และ description อย่างถูกต้อง (รองรับทั้ง /ct และ /create_ticket)
    const titleMatch = text.match(/\/(?:ct|create_ticket)\s+(.+)/);
    if (!titleMatch) {
      await this.bot.sendMessage(msg.chat.id, "❌ กรุณาระบุหัวข้อ ticket");
      return;
    }

    const fullText = titleMatch[1];
    const words = fullText.split(" ");
    const title = words[0];
    const description = words.slice(1).join(" ") || undefined;

    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    try {
      // ตรวจสอบว่าเป็น supergroup และรองรับ topics
      if (chat.type !== "supergroup") {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ Ticket สามารถสร้างได้เฉพาะใน Supergroup ที่เปิดใช้ Topics เท่านั้น\n\n" +
            "🔧 กรุณาอัพเกรดกลุ่มเป็น Supergroup และเปิดใช้ Topics",
        );
        return;
      }

      // ตรวจสอบสิทธิ์ bot ล่าสุด
      const permissions = await this.checkBotPermissions(chat.id.toString());

      if (!permissions.isAdmin) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่สามารถสร้าง Ticket ได้\n" +
            "🔧 Bot ไม่มีสิทธิ์ Admin ในกลุ่มนี้\n\n" +
            "👤 กรุณาให้ Admin ของกลุ่มตั้งค่าสิทธิ์ให้ Bot",
        );
        return;
      }

      if (!permissions.canManageTopics) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่สามารถสร้าง Topic ได้\n" +
            "🔧 Bot ไม่มีสิทธิ์จัดการ Topics\n\n" +
            "📋 กรุณาให้ Admin ตั้งค่าสิทธิ์:\n" +
            "• เปิดใช้ Topics ในกลุ่ม\n" +
            '• ให้สิทธิ์ "Manage Topics" กับ Bot',
        );
        return;
      }

      const group = await this.groupsService.findOrCreateGroup({
        telegramGroupId: chat.id.toString(),
        title: (chat as any).title || "Unknown Group",
        type: chat.type,
        botIsAdmin: permissions.isAdmin,
        supportTopicsEnabled: true,
      });

      // สร้าง ticket ในฐานข้อมูล
      const ticket = await this.ticketService.createTicket({
        title,
        description,
        createdBy: user.id.toString(),
        groupId: chat.id.toString(), // ใช้กลุ่มปัจจุบันสำหรับ ticket
      });

      // สร้าง forum topic
      const topicName = title;
      const topicResult = await this.createForumTopic(
        chat.id.toString(),
        topicName,
      );

      if (topicResult && topicResult.message_thread_id) {
        // สร้าง topic ใน database (ระบบใหม่จะอัปเดต ticket อัตโนมัติ)
        await this.topicsService.createTopic({
          telegramTopicId: topicResult.message_thread_id,
          name: topicName,
          groupId: chat.id.toString(),
          ticketId: ticket.ticketId,
          createdBy: user.id.toString(),
          isPrimary: true, // topic แรกเป็น primary
        });

        // เพิ่ม participant ใน ticket
        await this.ticketService.addParticipant(
          ticket.ticketId,
          user.id.toString(),
        );

        // ส่งข้อความต้อนรับใน topic
        const welcomeMessage =
          `📝 ${ticket.title}` +
          (description ? `\n${description}` : "") +
          `\n\n/cc ปิด Ticket | /mt @user เชิญคนเข้าร่วม`;

        await this.sendMessageToTopic(
          chat.id.toString(),
          topicResult.message_thread_id,
          welcomeMessage,
        );

        await this.bot.sendMessage(
          msg.chat.id,
          `✅ สร้าง Topic "${topicName}" แล้ว`,
        );

        // Trigger webhook for ticket created
        this.hooksService.trigger(
          HookEvent.TICKET_CREATED,
          {
            ticketId: ticket.ticketId,
            title: ticket.title,
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            groupId: chat.id.toString(),
            topicId: topicResult.message_thread_id,
            createdBy: {
              id: user.id.toString(),
              username: user.username,
              firstName: user.first_name,
            },
          },
          { groupId: chat.id.toString() },
        );
      } else {
        throw new Error("Failed to create forum topic");
      }
    } catch (error) {
      this.logger.error("Error creating ticket:", error);

      if (
        error.message?.includes("CHAT_NOT_MODIFIED") ||
        error.message?.includes("topics")
      ) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่สามารถสร้าง Topic ได้\n" +
            "🔧 กรุณาตรวจสอบว่า:\n" +
            "• กลุ่มเป็น Supergroup\n" +
            "• เปิดใช้ Topics ในกลุ่ม\n" +
            "• Bot มีสิทธิ์จัดการ Topics",
        );
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ เกิดข้อผิดพลาดในการสร้าง Ticket กรุณาลองใหม่อีกครั้ง",
        );
      }
    }
  }

  private async handleCloseTicket(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const message = msg;
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    // ตรวจสอบว่าอยู่ใน topic หรือไม่
    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic ของ Ticket เท่านั้น",
      );
      return;
    }

    try {
      // หา ticket จาก topic ID
      const ticket = await this.ticketService.findByTopicId(
        messageThreadId,
        chat.id.toString(),
      );
      if (!ticket) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้",
        );
        return;
      }

      // ตรวจสอบว่า ticket ปิดแล้วหรือไม่
      if (ticket.status === "closed") {
        await this.bot.sendMessage(msg.chat.id, "ℹ️ Ticket นี้ปิดแล้ว");
        return;
      }

      // ตรวจสอบสิทธิ์ในการปิด ticket (เจ้าของหรือ admin)
      const isCreator = ticket.createdBy === user.id.toString();
      const group = await this.groupsService.findByTelegramGroupId(
        chat.id.toString(),
      );

      if (!isCreator && !group?.botIsAdmin) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ คุณไม่มีสิทธิ์ปิด Ticket นี้ (เฉพาะผู้สร้าง Ticket เท่านั้น)",
        );
        return;
      }

      // ปิด ticket
      const closedTicket = await this.ticketService.closeTicket(
        ticket.ticketId,
      );

      // ปิด forum topic
      await this.closeForumTopic(chat.id.toString(), messageThreadId);

      // อัพเดท topic status ใน database
      await this.topicsService.deactivateTopic(
        messageThreadId,
        chat.id.toString(),
      );

      // คำนวณระยะเวลาที่ ticket เปิดอยู่
      const createdAt = new Date((ticket as any).createdAt);
      const closedAt = new Date();
      const duration = Math.round(
        (closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60),
      ); // ชั่วโมง

      // ส่งข้อความแจ้งการปิด
      const closeMessage =
        `✅ *Ticket ${ticket.ticketId} ได้รับการปิดแล้ว*\n\n` +
        `📅 ปิดเมื่อ: ${closedAt.toLocaleString("th-TH")}\n` +
        `👤 ปิดโดย: ${user.first_name}\n` +
        `⏱️ ระยะเวลาทำงาน: ${duration > 0 ? duration + " ชั่วโมง" : "น้อยกว่า 1 ชั่วโมง"}\n\n` +
        `🔒 Topic นี้จะไม่รับข้อความใหม่อีกต่อไป`;

      await this.bot.sendMessage(msg.chat.id, closeMessage, {
        parse_mode: "Markdown",
      });

      // Trigger webhook for ticket closed
      this.hooksService.trigger(
        HookEvent.TICKET_CLOSED,
        {
          ticketId: ticket.ticketId,
          title: ticket.title,
          status: "closed",
          groupId: chat.id.toString(),
          closedAt: closedAt.toISOString(),
          duration: duration,
          closedBy: {
            id: user.id.toString(),
            username: user.username,
            firstName: user.first_name,
          },
        },
        { groupId: chat.id.toString(), ticketStatus: "closed" },
      );
    } catch (error) {
      this.logger.error("Error closing ticket:", error);

      if (error.message?.includes("TOPIC_CLOSED")) {
        await this.bot.sendMessage(msg.chat.id, "ℹ️ Topic นี้ปิดแล้ว");
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ เกิดข้อผิดพลาดในการปิด Ticket กรุณาลองใหม่อีกครั้ง",
        );
      }
    }
  }

  private async handleMention(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const message = msg;
    const text = message?.text || "";
    const args = text.split(" ").slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    // ตรวจสอบว่าอยู่ใน topic หรือไม่
    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic ของ Ticket เท่านั้น",
      );
      return;
    }

    if (args.length === 0) {
      // แสดง reply markup ให้เลือกผู้ใช้ หรือ inline reply
      await this.showMentionOptions(msg, messageThreadId, chat.id.toString());
      return;
    }

    // แยก username (ลบ @ ถ้ามี)
    const targetUsername = args[0].replace("@", "");

    try {
      // หา topic และ ticket
      const topic = await this.topicsService.findByTelegramTopicId(
        messageThreadId,
        chat.id.toString(),
      );
      if (!topic || !topic.ticketId) {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้",
        );
        return;
      }

      const topicTicket = await this.ticketService.findByTicketId(
        topic.ticketId,
      );
      if (!topicTicket) {
        await this.bot.sendMessage(msg.chat.id, "❌ ไม่พบข้อมูล Ticket");
        return;
      }

      if (topicTicket.status === "closed") {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ ไม่สามารถเชิญคนเข้า Ticket ที่ปิดแล้ว",
        );
        return;
      }

      // ค้นหา user ในระบบ (เฉพาะ internal users)
      const targetUser = await this.usersService.findByUsername(targetUsername);
      if (!targetUser) {
        // แสดง reply markup เมื่อไม่เจอ user
        await this.showUserNotFoundOptions(
          msg,
          targetUsername,
          messageThreadId,
          chat.id.toString(),
        );
        return;
      }

      // ตรวจสอบว่าเป็น internal user (ไม่ใช่ bot)
      if (targetUser.isBot) {
        await this.bot.sendMessage(
          msg.chat.id,
          `❌ ไม่สามารถเชิญ Bot ได้: ${targetUsername}\n` +
            "👤 สามารถเชิญได้เฉพาะผู้ใช้จริงเท่านั้น",
        );
        return;
      }

      // ตรวจสอบว่า user อยู่ใน ticket แล้วหรือไม่
      const currentTicket = topic.ticketId
        ? await this.ticketService.findByTicketId(topic.ticketId)
        : null;
      if (
        currentTicket &&
        currentTicket.participants.includes(targetUser.telegramId)
      ) {
        await this.bot.sendMessage(
          msg.chat.id,
          `ℹ️ ${targetUsername} อยู่ใน Ticket นี้แล้ว`,
        );
        return;
      }

      // หา group ที่ User B pair ไว้
      const userBGroupId = await this.usersService.getUserDefaultGroup(
        targetUser.telegramId,
      );
      const targetGroupId = userBGroupId || chat.id.toString(); // fallback ไปกลุ่มปัจจุบันถ้าไม่ได้ pair

      // Debug logging (Mention Command)
      this.logger.log(`[${new Date().toISOString()}] 🔍 MENTION DEBUG (CMD):`);
      this.logger.log(`  - Original chatId: ${chat.id.toString()}`);
      this.logger.log(`  - User paired groupId: ${userBGroupId}`);
      this.logger.log(`  - Target groupId: ${targetGroupId}`);
      this.logger.log(`  - Username: ${targetUsername}`);

      // สร้าง topic ใหม่สำหรับ user ที่ถูก mention ในกลุ่มที่เขา pair ไว้
      const newTopicName = `👤 ${targetUser.firstName || targetUsername} - ${currentTicket?.ticketId || "UNKNOWN"}`;
      const newTopicResult = await this.createForumTopic(
        targetGroupId,
        newTopicName,
        0x6fb9f0, // Light blue color
      );

      if (!newTopicResult.success) {
        await this.bot.sendMessage(
          msg.chat.id,
          `❌ ไม่สามารถสร้าง Topic สำหรับ @${targetUsername} ได้`,
        );
        return;
      }

      // บันทึก topic ใหม่ในฐานข้อมูล (สร้างโดย user ที่ถูก mention)
      const newTopic = await this.topicsService.createTopic({
        telegramTopicId: newTopicResult.message_thread_id,
        groupId: targetGroupId, // แก้ไข Critical Bug: ใช้ targetGroupId แทน chat.id
        name: newTopicName,
        ticketId: topicTicket?.ticketId,
        createdBy: targetUser.telegramId, // สร้างโดย user ที่ถูก mention (userB)
      });

      // Debug logging (Topic Saved)
      this.logger.log(`[${new Date().toISOString()}] 💾 TOPIC SAVED:`);
      this.logger.log(
        `  - Telegram topicId: ${newTopicResult.message_thread_id}`,
      );
      this.logger.log(`  - Database groupId: ${targetGroupId}`);
      this.logger.log(`  - Linked to original topic: ${messageThreadId}`);

      // เชื่อมโยง topic เดิมกับ topic ใหม่
      await this.topicsService.linkTopics(
        messageThreadId,
        newTopicResult.message_thread_id,
        targetGroupId,
      );

      // เพิ่ม user เป็น participant ใน ticket
      if (topic.ticketId) {
        await this.ticketService.addParticipant(
          topic.ticketId,
          targetUser.telegramId,
        );
      }

      // ส่งข้อความแจ้งใน topic เดิม
      const originalTopicMessage =
        `✅ สร้าง Topic สำหรับ @${targetUsername} แล้ว\n` +
        `🎫 Ticket: ${topicTicket?.ticketId}\n` +
        `📝 หัวข้อ: ${topicTicket?.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n` +
        `🔗 Topic ของ @${targetUsername}: "${newTopicName}"\n\n` +
        `💬 ข้อความจะถูก sync ระหว่าง topics อัตโนมัติ`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        originalTopicMessage,
      );

      // ส่งข้อความแจ้งใน topic ใหม่
      const initialMessage =
        `🎯 **${targetUser.firstName || targetUsername}** ได้รับการเชิญเข้าร่วม Ticket\n\n` +
        `🎫 Ticket: ${topicTicket?.ticketId}\n` +
        `📝 หัวข้อ: ${topicTicket?.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n\n` +
        `💬 นี่คือพื้นที่สนทนาส่วนตัวสำหรับ ${targetUser.firstName || targetUsername}\n` +
        `🔗 ข้อความจะถูก sync กับ Topic หลักอัตโนมัติ\n\n` +
        `📞 @${targetUsername} กรุณาส่งข้อความเพื่อเริ่มการสนทนา`;

      try {
        await this.sendMessageToTopic(
          chat.id.toString(),
          newTopicResult.message_thread_id,
          initialMessage,
        );
      } catch (sendError) {
        // If topic doesn't exist, delete the topic and all its relations
        if (
          sendError.message &&
          sendError.message.includes("message thread not found")
        ) {
          this.logger.warn(
            `[${new Date().toISOString()}] 🧹 Topic ${newTopicResult.message_thread_id} not found - deleting from database`,
          );
          await this.topicsService.deleteTopicAndRelations(
            newTopicResult.message_thread_id,
            chat.id.toString(),
          );
        } else {
          this.logger.error(
            `[${new Date().toISOString()}] ❌ Failed to send initial message to topic ${newTopicResult.message_thread_id}:`,
            sendError.message,
          );
        }

        // Don't throw - let the mention process continue
        this.logger.log(
          `[${new Date().toISOString()}] ⚠️ Mention created but initial message failed - topic may have been deleted`,
        );
      }

      // ส่งการแจ้งเตือนให้ user ที่ถูก mention (ถ้าเป็นไปได้)
      try {
        await this.notifyMentionedUser(
          targetUser,
          topicTicket,
          newTopicResult.message_thread_id,
          chat.id.toString(),
          user.first_name,
        );
      } catch (error) {
        this.logger.log(
          `Could not send direct notification to user ${targetUsername}:`,
          error.message,
        );
      }
    } catch (error) {
      this.logger.error("Error handling mention:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการเชิญ User กรุณาลองใหม่อีกครั้ง",
      );
    }
  }

  private async showMentionOptions(
    msg: TelegramBot.Message,
    messageThreadId: number,
    groupId: string,
  ) {
    try {
      // แสดงตัวเลือกสำหรับ mention user เท่านั้น
      const buttons = [
        [
          {
            text: "👥 เชิญผู้ใช้",
            callback_data: "mention_action:show_users",
          },
        ],
        [
          {
            text: "❌ ยกเลิก",
            callback_data: "mention:cancel",
          },
        ],
      ];

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        "🎯 เลือกการกระทำ:\n\n" +
          "👥 เชิญผู้ใช้ - เชิญ Internal User เข้าร่วม Topic",
        { reply_markup: inlineKeyboard },
      );
    } catch (error) {
      this.logger.error("Error showing mention options:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการแสดงตัวเลือก",
      );
    }
  }

  private async showUserSelectionMenu(
    msg: TelegramBot.Message,
    messageThreadId: number,
    groupId: string,
  ) {
    try {
      // หา topic และ participants ปัจจุบัน
      const topic = await this.topicsService.findByTelegramTopicId(
        messageThreadId,
        groupId,
      );
      if (!topic) {
        await this.bot.sendMessage(msg.chat.id, "❌ ไม่พบข้อมูล Topic");
        return;
      }

      // ค้นหาผู้ใช้ที่สามารถเชิญได้ (ยกเว้นคนที่อยู่ใน ticket แล้ว)
      const ticket = topic.ticketId
        ? await this.ticketService.findByTicketId(topic.ticketId)
        : null;
      const participants = ticket?.participants || [];
      const availableUsers =
        await this.usersService.findAllActiveUsers(participants);

      if (availableUsers.length === 0) {
        await this.bot.sendMessage(
          msg.chat.id,
          "ℹ️ ไม่มีผู้ใช้ที่สามารถเชิญได้\n\n" +
            "💡 ผู้ใช้ทุกคนอยู่ใน Topic นี้แล้ว หรือยังไม่มีผู้ใช้ในระบบ",
        );
        return;
      }

      // สร้าง inline keyboard
      const buttons = [];

      // จัดกลุ่มเป็น 2 คอลัมน์ต่อแถว
      for (let i = 0; i < availableUsers.length; i += 2) {
        const row = [];

        const user1 = availableUsers[i];
        const displayName1 = user1.firstName || user1.username;
        row.push({
          text: `👤 ${displayName1}`,
          callback_data: `mention:${user1.username}`,
        });

        if (i + 1 < availableUsers.length) {
          const user2 = availableUsers[i + 1];
          const displayName2 = user2.firstName || user2.username;
          row.push({
            text: `👤 ${displayName2}`,
            callback_data: `mention:${user2.username}`,
          });
        }

        buttons.push(row);
      }

      // เพิ่มปุ่มยกเลิก
      buttons.push([
        {
          text: "❌ ยกเลิก",
          callback_data: "mention:cancel",
        },
      ]);

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `👥 เลือกผู้ใช้ที่ต้องการเชิญเข้าร่วม Topic\n\n` +
          `📋 ผู้ใช้ที่สามารถเชิญได้: ${availableUsers.length} คน`,
        { reply_markup: inlineKeyboard },
      );
    } catch (error) {
      this.logger.error("Error showing user selection menu:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการแสดงรายชื่อผู้ใช้",
      );
    }
  }

  private async handleChatMemberUpdate(update: any) {
    const chat = update.chat;

    if (update?.new_chat_member?.user?.id) {
      this.logger.log(
        `[${new Date().toISOString()}] API Call: getMe (chat member update)`,
      );
      const startTime = Date.now();

      const me = await this.bot.getMe();
      const duration = Date.now() - startTime;

      this.logger.log(
        `[${new Date().toISOString()}] API Response: getMe - Duration: ${duration}ms, botId: ${me.id}`,
      );

      if (update.new_chat_member.user.id === me.id) {
        const status = update.new_chat_member.status;
        const isAdmin = status === "administrator";

        if (chat) {
          await this.groupsService.findOrCreateGroup({
            telegramGroupId: chat.id.toString(),
            title: chat.title || "Unknown Group",
            type: chat.type,
            botIsAdmin: isAdmin,
            supportTopicsEnabled: (chat as any).has_topics_enabled || false,
          });
        }
      }
    }
  }

  private async handleMessage(msg: TelegramBot.Message) {
    const message = msg;
    const user = msg.from;

    // 📥 Log incoming message
    const messageThreadId = (message as any)?.message_thread_id;
    const chatType = msg.chat?.type || "unknown";
    const messageText =
      msg.text?.substring(0, 100) +
      (msg.text && msg.text.length > 100 ? "..." : "");
    const userName = user?.username || user?.first_name || "Unknown";
    const hasAttachment = !!(
      msg.photo ||
      msg.document ||
      msg.video ||
      msg.audio ||
      msg.voice ||
      msg.sticker
    );

    this.logger.log(`[${new Date().toISOString()}] 📥 INCOMING MESSAGE:`);
    this.logger.log(`  - Chat: ${msg.chat?.id} (${chatType})`);
    this.logger.log(`  - User: ${userName} (${user?.id})`);
    this.logger.log(`  - Topic: ${messageThreadId || "N/A"}`);
    this.logger.log(`  - Text: "${messageText || "[No text]"}"`);
    this.logger.log(`  - Has attachment: ${hasAttachment}`);
    this.logger.log(`  - Message ID: ${msg.message_id}`);

    if (user && msg.chat?.type !== "private") {
      // สร้างหรืออัพเดท user ในฐานข้อมูล
      await this.usersService.findOrCreateUser({
        telegramId: user.id.toString(),
        username: user.username || user.first_name || "Unknown",
        firstName: user.first_name,
        lastName: user.last_name,
        isBot: user.is_bot,
        languageCode: user.language_code,
      });

      // ตรวจสอบว่าเป็นข้อความใน topic หรือไม่
      const messageThreadId = message?.message_thread_id;
      if (messageThreadId) {
        await this.handleTopicMessage(msg, messageThreadId);
      }
    }
  }

  private async handleTopicMessage(
    msg: TelegramBot.Message,
    messageThreadId: number,
  ) {
    const message = msg;
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat) return;

    try {
      this.logger.log(`[${new Date().toISOString()}] 🔍 TOPIC LOOKUP:`);
      this.logger.log(
        `  - Looking for topicId: ${messageThreadId} in group: ${chat.id.toString()}`,
      );

      // หา topic ในฐานข้อมูล - รองรับ cross-group
      let topic = await this.topicsService.findByTelegramTopicId(
        messageThreadId,
        chat.id.toString(),
      );

      if (topic) {
        this.logger.log(
          `  ✅ Found topic in current group: ${topic.name || "Unnamed"}`,
        );
      } else {
        this.logger.log(
          `  ❌ Topic not found in current group, searching globally...`,
        );

        // ถ้าไม่เจอใน group ปัจจุบัน ให้ค้นหาใน group อื่น (cross-group support)
        const allTopics =
          await this.topicsService.findByTelegramTopicIdGlobal(messageThreadId);
        this.logger.log(
          `  📊 Found ${allTopics.length} topics globally with ID ${messageThreadId}`,
        );

        topic = allTopics.find((t) => t.groupId === chat.id.toString());

        if (!topic && allTopics.length > 0) {
          // ใช้ topic แรกที่เจอ (สำหรับ cross-group sync)
          topic = allTopics[0];
          this.logger.log(
            `  🔄 Cross-group message detected: topic in group ${topic.groupId}, message from group ${chat.id.toString()}`,
          );
        }
      }

      if (!topic) {
        this.logger.log(
          `  ⚠️ No topic found anywhere - skipping message processing`,
        );
        return;
      }

      this.logger.log(
        `  ✅ Processing message in topic: ${topic.name || "Unnamed"} (${topic.groupId})`,
      );

      // ดึงข้อมูล ticket เพื่อดู participants และ linked topics
      let ticket = null;
      if (topic.ticketId) {
        ticket = await this.ticketService.findByTicketId(topic.ticketId);
        this.logger.log(
          `  🎫 Ticket: ${ticket?.ticketId} has ${ticket?.topics?.length || 0} topics`,
        );
        this.logger.log(
          `  👥 Ticket has ${ticket?.participants?.length || 0} participants`,
        );
      }

      // เพิ่ม user เป็น participant ใน ticket (ถ้ายังไม่มี)
      if (ticket && !ticket.participants.includes(user.id.toString())) {
        await this.ticketService.addParticipant(
          ticket.ticketId,
          user.id.toString(),
        );
      }

      // บันทึกข้อความและ attachments ใน database (Phase 4 - Enhanced)
      await this.processMessageWithMetadata(msg, topic);

      // อัปเดตสถิติข้อความ
      if (topic.ticketId) {
        await this.topicsService.incrementMessageCount(
          messageThreadId,
          topic.groupId,
        );
      }

      // Sync message to linked topics (Phase 3 feature)
      await this.syncMessageToLinkedTopics(msg, topic);

      // ตรวจสอบว่า topic เชื่อมโยงกับ ticket และยังเปิดอยู่หรือไม่
      if (topic.ticketId) {
        const ticket = await this.ticketService.findByTicketId(topic.ticketId);
        if (ticket && ticket.status === "closed") {
          // แจ้งให้ทราบว่า ticket ปิดแล้ว (บางครั้ง)
          const now = Date.now();
          const lastWarning = (this as any).lastClosedWarning || 0;

          if (now - lastWarning > 60000) {
            // แจ้งทุก 1 นาที
            await this.bot.sendMessage(
              msg.chat.id,
              "ℹ️ Ticket นี้ปิดแล้ว แต่ยังสามารถสนทนาได้",
            );
            (this as any).lastClosedWarning = now;
          }
        }
      }
    } catch (error) {
      this.logger.error("Error handling topic message:", error);
    }
  }

  private async saveMessageToDatabase(
    msg: TelegramBot.Message,
    topic: any,
  ): Promise<void> {
    try {
      const messageType = this.messagesService.determineMessageType(msg);
      const replyInfo = this.messagesService.extractReplyInfo(msg);
      const forwardInfo = this.messagesService.extractForwardInfo(msg);

      // Save message to database
      const messageData = {
        telegramMessageId: msg.message_id,
        messageType,
        text: msg.text,
        caption: msg.caption,
        senderId: msg.from?.id.toString(),
        senderUsername: msg.from?.username,
        senderFirstName: msg.from?.first_name,
        senderLastName: msg.from?.last_name,
        groupId: msg.chat?.id.toString(),
        topicId: (msg as any).message_thread_id,
        ticketId: topic.ticketId,
        ...replyInfo,
        ...forwardInfo,
        hasAttachments: false,
        attachmentIds: [],
      };

      const savedMessage = await this.messagesService.saveMessage(messageData);

      // Handle attachments if present
      const attachmentIds = await this.handleMessageAttachments(
        msg,
        topic,
        (savedMessage as any)._id.toString(),
      );

      if (attachmentIds.length > 0) {
        await this.messagesService.updateAttachments(
          (savedMessage as any)._id.toString(),
          attachmentIds,
        );
      }
    } catch (error) {
      this.logger.error("Error saving message to database:", error);
    }
  }

  private async handleMessageAttachments(
    msg: TelegramBot.Message,
    topic: any,
    messageId: string,
  ): Promise<string[]> {
    const attachmentIds: string[] = [];
    const processedFileIds: Set<string> = new Set(); // Track processed file_ids to avoid duplicates

    try {
      // Handle different types of attachments
      const attachmentPromises: Promise<string | null>[] = [];

      // Photos
      if (msg.photo && msg.photo.length > 0) {
        const largestPhoto = msg.photo[msg.photo.length - 1]; // Get highest resolution
        if (!processedFileIds.has(largestPhoto.file_id)) {
          processedFileIds.add(largestPhoto.file_id);
          attachmentPromises.push(
            this.saveAttachmentInfo(
              largestPhoto,
              "photo",
              msg,
              topic,
              messageId,
            ),
          );
        }
      }

      // Documents
      if (msg.document && !processedFileIds.has(msg.document.file_id)) {
        processedFileIds.add(msg.document.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(
            msg.document,
            "document",
            msg,
            topic,
            messageId,
          ),
        );
      }

      // Video
      if (msg.video && !processedFileIds.has(msg.video.file_id)) {
        processedFileIds.add(msg.video.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(msg.video, "video", msg, topic, messageId),
        );
      }

      // Audio
      if (msg.audio && !processedFileIds.has(msg.audio.file_id)) {
        processedFileIds.add(msg.audio.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(msg.audio, "audio", msg, topic, messageId),
        );
      }

      // Voice
      if (msg.voice && !processedFileIds.has(msg.voice.file_id)) {
        processedFileIds.add(msg.voice.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(msg.voice, "voice", msg, topic, messageId),
        );
      }

      // Video note
      if (msg.video_note && !processedFileIds.has(msg.video_note.file_id)) {
        processedFileIds.add(msg.video_note.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(
            msg.video_note,
            "video_note",
            msg,
            topic,
            messageId,
          ),
        );
      }

      // Sticker
      if (msg.sticker && !processedFileIds.has(msg.sticker.file_id)) {
        processedFileIds.add(msg.sticker.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(
            msg.sticker,
            "sticker",
            msg,
            topic,
            messageId,
          ),
        );
      }

      // Animation/GIF - Check if this file_id was already processed as document
      if (msg.animation && !processedFileIds.has(msg.animation.file_id)) {
        processedFileIds.add(msg.animation.file_id);
        attachmentPromises.push(
          this.saveAttachmentInfo(
            msg.animation,
            "animation",
            msg,
            topic,
            messageId,
          ),
        );
      }

      const results = await Promise.all(attachmentPromises);
      attachmentIds.push(...(results.filter((id) => id !== null) as string[]));

      this.logger.log(
        `  📎 Processed ${attachmentIds.length} unique attachments (filtered duplicates)`,
      );
    } catch (error) {
      this.logger.error("Error handling message attachments:", error);
    }

    return attachmentIds;
  }

  private async saveAttachmentInfo(
    fileInfo: any,
    type: string,
    msg: TelegramBot.Message,
    topic: any,
    messageId: string,
  ): Promise<string | null> {
    try {
      // Validate file
      const validation = this.attachmentsService.validateFile(fileInfo);
      if (!validation.isValid) {
        this.logger.warn(`File validation failed: ${validation.reason}`);
        // Send warning message to topic but don't block the message
        await this.sendMessageToTopic(
          msg.chat?.id.toString() || "",
          (msg as any).message_thread_id,
          `⚠️ **File Warning**\n\n${validation.reason}\n\nFile was not saved but message was delivered.`,
        );
        return null;
      }

      const attachmentType = this.attachmentsService.determineAttachmentType({
        [type]: fileInfo,
      });

      const attachmentData = {
        telegramFileId: fileInfo.file_id,
        fileName: fileInfo.file_name || `${type}_${Date.now()}`,
        fileType: attachmentType,
        mimeType: fileInfo.mime_type,
        fileSize: fileInfo.file_size || 0,
        width: fileInfo.width,
        height: fileInfo.height,
        duration: fileInfo.duration,
        caption: msg.caption,
        uploadedBy: msg.from?.id.toString(),
        groupId: msg.chat?.id.toString(),
        topicId: (msg as any).message_thread_id,
        ticketId: topic.ticketId,
        messageId: msg.message_id,
        thumbnailFileId: fileInfo.thumb?.file_id,
      };

      const savedAttachment =
        await this.attachmentsService.saveAttachment(attachmentData);

      // Start download in background (Phase 4 feature)
      this.downloadAttachmentInBackground(savedAttachment.telegramFileId);

      return (savedAttachment as any)._id.toString();
    } catch (error) {
      this.logger.error("Error saving attachment info:", error);
      return null;
    }
  }

  private async downloadAttachmentInBackground(
    telegramFileId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] API Call: getFile - fileId: ${telegramFileId}`,
      );
      const startTime = Date.now();

      const fileInfo = await this.withRetry(
        () => this.bot.getFile(telegramFileId),
        3,
        1000,
        "getFile",
      );
      const duration = Date.now() - startTime;

      this.logger.log(
        `[${new Date().toISOString()}] API Response: getFile - Duration: ${duration}ms, filePath: ${fileInfo.file_path}`,
      );

      const fileUrl = `https://api.telegram.org/file/bot${this.configService.get("telegram.botToken")}/${fileInfo.file_path}`;

      const attachment =
        await this.attachmentsService.findByFileId(telegramFileId);
      if (!attachment) return;

      const localFileName = this.attachmentsService.generateLocalFileName(
        attachment.fileName,
        telegramFileId,
      );
      const localFilePath =
        this.attachmentsService.getLocalFilePath(localFileName);

      await this.downloadFileWithRetry(fileUrl, localFilePath, 3);
      await this.attachmentsService.markAsDownloaded(
        telegramFileId,
        localFilePath,
      );

      this.logger.log(`Downloaded attachment: ${localFileName}`);
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] API Error: getFile - fileId: ${telegramFileId}`,
        error,
      );
    }
  }

  private async downloadFileWithRetry(
    url: string,
    localPath: string,
    maxRetries: number = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.downloadFile(url, localPath);
        return;
      } catch (error) {
        this.logger.warn(`Download attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) {
          throw error;
        }
        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000),
        );
      }
    }
  }

  private async downloadFile(url: string, localPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = require("fs").createWriteStream(localPath);
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `HTTP ${response.statusCode}: ${response.statusMessage}`,
              ),
            );
            return;
          }

          response.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve();
          });

          file.on("error", (error) => {
            require("fs").unlink(localPath, () => {}); // Delete the file on error
            reject(error);
          });
        })
        .on("error", reject);
    });
  }

  private async syncMessageToLinkedTopics(
    msg: TelegramBot.Message,
    sourceTopic: any,
  ) {
    try {
      const messageThreadId = (msg as any).message_thread_id;
      const user = msg.from;
      const messageText = msg.text;
      const chat = msg.chat;

      if (!messageThreadId || !user || !messageText || !chat) {
        return;
      }

      this.logger.log(
        `[${new Date().toISOString()}] 🔄 SYNC MESSAGE TO LINKED TOPICS:`,
      );
      this.logger.log(
        `  - Source topic: ${messageThreadId} in group ${chat.id.toString()}`,
      );
      this.logger.log(
        `  - Message: "${messageText.substring(0, 50)}${messageText.length > 50 ? "..." : ""}"`,
      );

      // Get linked topics with enhanced debugging
      this.logger.log(
        `  🔍 Looking up linked topics for topic ${messageThreadId} in group ${chat.id.toString()}`,
      );
      const linkedTopics = await this.topicsService.getLinkedTopics(
        messageThreadId,
        chat.id.toString(),
      );
      this.logger.log(
        `  📊 Found ${linkedTopics.length} linked topics:`,
        linkedTopics.map((lt) => `${lt.topicId}@${lt.groupId}`).join(", "),
      );

      if (linkedTopics.length === 0) {
        this.logger.log(`  ⚠️ No linked topics found - skipping sync`);
        this.logger.log(
          `  🔍 Debug: Checking if topic ${messageThreadId} exists in database...`,
        );
        const topicExists = await this.topicsService.findByTelegramTopicId(
          messageThreadId,
          chat.id.toString(),
        );
        if (topicExists) {
          this.logger.log(
            `  ✅ Topic found in database but has no linked topics`,
          );
          this.logger.log(
            `  📋 Topic ticketId:`,
            topicExists.ticketId || "none",
          );
        } else {
          this.logger.log(
            `  ❌ Topic not found in database - this could be the issue`,
          );
        }
        return;
      }

      // Prepare sync message
      let syncMessage = `🔗 **Synced Message**\n\n`;
      syncMessage += `📝 ${messageText}\n\n`;
      syncMessage += `👤 จาก: ${user.first_name || user.username || "ผู้ใช้"}\n`;

      // Send to all linked topics (Cross-group support)
      this.logger.log(
        `  🔄 Starting sync process to ${linkedTopics.length} linked topics...`,
      );
      for (const linkedTopic of linkedTopics) {
        this.logger.log(
          `    🎯 Syncing to topic ${linkedTopic.topicId} in group ${linkedTopic.groupId}...`,
        );
        try {
          // ไม่ต้องค้นหาแล้ว เพราะเรารู้ groupId อยู่แล้ว!
          if (linkedTopic.groupId === chat.id.toString()) {
            this.logger.log(
              `      ✅ Same-group sync to topic ${linkedTopic.topicId}`,
            );
            await this.sendMessageToTopic(
              chat.id.toString(),
              linkedTopic.topicId,
              syncMessage,
            );
          } else {
            this.logger.log(
              `      ✅ Cross-group sync: ${chat.id.toString()} → ${linkedTopic.groupId} (topic: ${linkedTopic.topicId})`,
            );
            await this.sendMessageToTopic(
              linkedTopic.groupId,
              linkedTopic.topicId,
              syncMessage,
            );
          }
        } catch (error) {
          // If it's "message thread not found", delete the topic and relations
          if (
            error.message &&
            error.message.includes("message thread not found")
          ) {
            this.logger.warn(
              `[${new Date().toISOString()}] 🧹 Topic ${linkedTopic.topicId}@${linkedTopic.groupId} not found - deleting from database`,
            );
            await this.topicsService.deleteTopicAndRelations(
              linkedTopic.topicId,
              linkedTopic.groupId,
            );
          } else {
            this.logger.error(
              `[${new Date().toISOString()}] ❌ Error syncing message to topic ${linkedTopic.topicId}:`,
              error.message,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error("Error syncing message to linked topics:", error);
    }
  }

  private async handleLinkTopic(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const message = msg;
    const text = message?.text || "";
    const args = text.split(" ").slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic เท่านั้น",
      );
      return;
    }

    if (args.length === 0) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ กรุณาระบุ Topic ID ที่ต้องการเชื่อมโยง\n\n" +
          "📝 ตัวอย่าง: /link_topic 123\n" +
          "💡 ใช้คำสั่งในทั้งสอง Topic ที่ต้องการเชื่อมโยง",
      );
      return;
    }

    const targetTopicId = parseInt(args[0]);
    if (isNaN(targetTopicId)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Topic ID ต้องเป็นตัวเลขเท่านั้น",
      );
      return;
    }

    try {
      // ตรวจสอบ topic ต้นทาง
      const sourceTopic = await this.topicsService.findByTelegramTopicId(
        messageThreadId,
        chat.id.toString(),
      );
      if (!sourceTopic) {
        await this.bot.sendMessage(msg.chat.id, "❌ ไม่พบข้อมูล Topic นี้");
        return;
      }

      // ตรวจสอบ topic ปลายทาง
      const targetTopic = await this.topicsService.findByTelegramTopicId(
        targetTopicId,
        chat.id.toString(),
      );
      if (!targetTopic) {
        await this.bot.sendMessage(
          msg.chat.id,
          `❌ ไม่พบ Topic ID: ${targetTopicId} ในกลุ่มนี้`,
        );
        return;
      }

      // ตรวจสอบว่าเชื่อมโยงแล้วหรือไม่
      const linkedTopics = await this.topicsService.getLinkedTopics(
        messageThreadId,
        chat.id.toString(),
      );
      if (linkedTopics.some((lt) => lt.topicId === targetTopicId)) {
        await this.bot.sendMessage(
          msg.chat.id,
          `ℹ️ Topic นี้เชื่อมโยงกับ Topic ${targetTopicId} แล้ว`,
        );
        return;
      }

      // เชื่อมโยง topics
      await this.topicsService.linkTopics(
        messageThreadId,
        targetTopicId,
        chat.id.toString(),
      );

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔗 **เชื่อมโยง Topic สำเร็จ**\n\n` +
        `📋 Topic นี้เชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 เชื่อมโยงโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความใน Topic นี้จะถูกส่งไป Topic ${targetTopicId} อัตโนมัติ`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        sourceMessage,
      );

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔗 **Topic ถูกเชื่อมโยง**\n\n` +
        `📋 Topic นี้เชื่อมโยงกับ Topic ${messageThreadId} แล้ว\n` +
        `👤 เชื่อมโยงโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความใน Topic ${messageThreadId} จะถูกส่งมา Topic นี้อัตโนมัติ`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        targetTopicId,
        targetMessage,
      );
    } catch (error) {
      this.logger.error("Error linking topics:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการเชื่อมโยง Topic",
      );
    }
  }

  private async handleUnlinkTopic(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const message = msg;
    const text = message?.text || "";
    const args = text.split(" ").slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic เท่านั้น",
      );
      return;
    }

    if (args.length === 0) {
      // แสดงรายการ linked topics ที่สามารถยกเลิกได้
      await this.showLinkedTopicsMenu(msg, messageThreadId, chat.id.toString());
      return;
    }

    const targetTopicId = parseInt(args[0]);
    if (isNaN(targetTopicId)) {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ Topic ID ต้องเป็นตัวเลขเท่านั้น",
      );
      return;
    }

    try {
      // ตรวจสอบว่าเชื่อมโยงกันอยู่หรือไม่
      const linkedTopics = await this.topicsService.getLinkedTopics(
        messageThreadId,
        chat.id.toString(),
      );
      if (!linkedTopics.some((lt) => lt.topicId === targetTopicId)) {
        await this.bot.sendMessage(
          msg.chat.id,
          `❌ Topic นี้ไม่ได้เชื่อมโยงกับ Topic ${targetTopicId}`,
        );
        return;
      }

      // ยกเลิกการเชื่อมโยง
      await this.topicsService.unlinkTopics(
        messageThreadId,
        targetTopicId,
        chat.id.toString(),
      );

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔓 **ยกเลิกการเชื่อมโยง Topic**\n\n` +
        `📋 ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความจะไม่ถูกส่งไป Topic ${targetTopicId} อีกต่อไป`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        sourceMessage,
      );

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔓 **การเชื่อมโยงถูกยกเลิก**\n\n` +
        `📋 การเชื่อมโยงกับ Topic ${messageThreadId} ถูกยกเลิกแล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString("th-TH")}\n\n` +
        `💬 ข้อความจาก Topic ${messageThreadId} จะไม่ถูกส่งมาอีกต่อไป`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        targetTopicId,
        targetMessage,
      );
    } catch (error) {
      this.logger.error("Error unlinking topics:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการยกเลิกการเชื่อมโยง Topic",
      );
    }
  }

  private async showLinkedTopicsMenu(
    msg: TelegramBot.Message,
    messageThreadId: number,
    groupId: string,
  ) {
    try {
      const linkedTopics = await this.topicsService.getLinkedTopics(
        messageThreadId,
        groupId,
      );

      if (linkedTopics.length === 0) {
        await this.bot.sendMessage(
          msg.chat.id,
          "ℹ️ Topic นี้ไม่ได้เชื่อมโยงกับ Topic อื่น\n\n" +
            "🔗 ใช้ /link_topic <topic_id> เพื่อเชื่อมโยง Topic",
        );
        return;
      }

      // สร้าง inline keyboard
      const buttons = [];

      for (const topicId of linkedTopics) {
        buttons.push([
          {
            text: `🔓 ยกเลิก Topic ${topicId}`,
            callback_data: `unlink:${topicId}`,
          },
        ]);
      }

      buttons.push([
        {
          text: "❌ ยกเลิก",
          callback_data: "mention:cancel",
        },
      ]);

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `🔗 **Topic ที่เชื่อมโยงกัน**\n\n` +
          `📋 Topic นี้เชื่อมโยงกับ ${linkedTopics.length} Topic:\n` +
          linkedTopics.map((id) => `• Topic ${id}`).join("\n") +
          "\n\n" +
          `🔓 เลือก Topic ที่ต้องการยกเลิกการเชื่อมโยง:`,
        { reply_markup: inlineKeyboard },
      );
    } catch (error) {
      this.logger.error("Error showing linked topics menu:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการแสดงรายการ Topic ที่เชื่อมโยง",
      );
    }
  }

  private async showUserNotFoundOptions(
    msg: TelegramBot.Message,
    searchedUsername: string,
    messageThreadId: number,
    groupId: string,
  ) {
    try {
      // ค้นหา users ที่คล้ายกัน
      const similarUsers = await this.usersService.searchUsersByUsername(
        searchedUsername,
        5,
      );

      const buttons = [];

      // ถ้ามี users ที่คล้ายกัน
      if (similarUsers.length > 0) {
        buttons.push([
          {
            text: "🔍 ผู้ใช้ที่คล้ายกัน",
            callback_data: "user_not_found:show_similar",
          },
        ]);
      }

      // เพิ่มตัวเลือกอื่นๆ
      buttons.push([
        {
          text: "👥 เลือกจากรายชื่อทั้งหมด",
          callback_data: "user_not_found:show_all",
        },
      ]);

      buttons.push([
        {
          text: "💬 Inline Reply แทน",
          callback_data: "user_not_found:inline_reply",
        },
      ]);

      buttons.push([
        {
          text: "❌ ยกเลิก",
          callback_data: "mention:cancel",
        },
      ]);

      const inlineKeyboard = { inline_keyboard: buttons };

      // Store context for callback
      this.setUserNotFoundContext(msg.from?.id.toString(), {
        searchedUsername,
        messageThreadId,
        groupId,
        similarUsers: similarUsers.map((u) => ({
          username: u.username,
          firstName: u.firstName,
          telegramId: u.telegramId,
        })),
      });

      // ส่งข้อความใน topic ที่กำลังใช้งาน
      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `❌ **ไม่พบผู้ใช้: @${searchedUsername}**\n\n` +
          `🔍 สามารถเชิญได้เฉพาะ Internal Users เท่านั้น\n` +
          (similarUsers.length > 0
            ? `💡 พบผู้ใช้ที่คล้ายกัน ${similarUsers.length} คน\n\n`
            : "\n") +
          `เลือกการกระทำ:`,
        { reply_markup: inlineKeyboard },
      );
    } catch (error) {
      this.logger.error("Error showing user not found options:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        `❌ ไม่พบผู้ใช้ในระบบ: ${searchedUsername}\n` +
          "🔍 สามารถเชิญได้เฉพาะ Internal Users เท่านั้น\n\n" +
          "💡 ผู้ใช้ต้องเคยใช้งาน Bot ในกลุ่มนี้มาก่อน",
      );
    }
  }

  private userNotFoundContexts = new Map<
    string,
    {
      searchedUsername: string;
      messageThreadId: number;
      groupId: string;
      similarUsers: Array<{
        username: string;
        firstName?: string;
        telegramId: string;
      }>;
      timestamp: number;
    }
  >();

  private setUserNotFoundContext(userId: string, context: any) {
    this.userNotFoundContexts.set(userId, {
      ...context,
      timestamp: Date.now(),
    });

    // Auto cleanup after 5 minutes
    setTimeout(
      () => {
        this.userNotFoundContexts.delete(userId);
      },
      5 * 60 * 1000,
    );
  }

  private getUserNotFoundContext(userId: string) {
    const context = this.userNotFoundContexts.get(userId);
    if (context && Date.now() - context.timestamp < 5 * 60 * 1000) {
      return context;
    }
    this.userNotFoundContexts.delete(userId);
    return null;
  }

  private async handleUserNotFoundCallback(
    callbackQuery: TelegramBot.CallbackQuery,
    data: string,
  ) {
    try {
      const user = callbackQuery.from;
      const message = callbackQuery.message;

      if (!user || !message) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ข้อมูลไม่ครบถ้วน",
        });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot
          .deleteMessage(
            callbackQuery.message.chat.id,
            callbackQuery.message.message_id,
          )
          .catch(() => {});
      }

      const context = this.getUserNotFoundContext(user.id.toString());
      if (!context) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ข้อมูลหมดอายุแล้ว",
        });
        return;
      }

      const action = data.replace("user_not_found:", "");

      switch (action) {
        case "show_similar":
          await this.showSimilarUsers(callbackQuery, context);
          break;
        case "show_all":
          await this.showAllUsers(callbackQuery, context);
          break;
        case "inline_reply":
          await this.handleInlineReplyFromNotFound(callbackQuery, context);
          break;
        default:
          await this.bot.answerCallbackQuery(callbackQuery.id, {
            text: "❌ การกระทำไม่ถูกต้อง",
          });
      }
    } catch (error) {
      this.logger.error("Error handling user not found callback:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async showSimilarUsers(
    callbackQuery: TelegramBot.CallbackQuery,
    context: any,
  ) {
    try {
      const similarUsers = context.similarUsers;

      if (similarUsers.length === 0) {
        await this.bot.answerCallbackQuery(callbackQuery.id, {
          text: "❌ ไม่มีผู้ใช้ที่คล้ายกัน",
        });
        return;
      }

      const buttons = [];

      for (const user of similarUsers) {
        const displayName = user.firstName || user.username;
        buttons.push([
          {
            text: `👤 ${displayName} (@${user.username})`,
            callback_data: `mention:${user.username}`,
          },
        ]);
      }

      buttons.push([
        {
          text: "🔙 กลับ",
          callback_data: "user_not_found:back",
        },
      ]);

      buttons.push([
        {
          text: "❌ ยกเลิก",
          callback_data: "mention:cancel",
        },
      ]);

      const inlineKeyboard = { inline_keyboard: buttons };

      // ส่งข้อความใน topic ที่กำลังใช้งาน
      await this.sendMessageToTopic(
        context.groupId,
        context.messageThreadId,
        `🔍 **ผู้ใช้ที่คล้ายกับ "@${context.searchedUsername}":**\n\n` +
          `พบ ${similarUsers.length} คน ที่มีชื่อคล้ายกัน:\n\n` +
          `เลือกผู้ใช้ที่ต้องการเชิญ:`,
        { reply_markup: inlineKeyboard },
      );

      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "แสดงผู้ใช้ที่คล้ายกัน",
      });
    } catch (error) {
      this.logger.error("Error showing similar users:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async showAllUsers(
    callbackQuery: TelegramBot.CallbackQuery,
    context: any,
  ) {
    try {
      const messageThreadId = context.messageThreadId;
      const groupId = context.groupId;

      // Use existing showUserSelectionMenu method but send in topic
      const fakeMessage = {
        chat: { id: parseInt(groupId) },
        from: callbackQuery.from,
        message_thread_id: messageThreadId,
      } as any;

      await this.showUserSelectionMenu(fakeMessage, messageThreadId, groupId);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "แสดงรายชื่อผู้ใช้ทั้งหมด",
      });
    } catch (error) {
      this.logger.error("Error showing all users:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  private async handleInlineReplyFromNotFound(
    callbackQuery: TelegramBot.CallbackQuery,
    context: any,
  ) {
    try {
      const messageThreadId = context.messageThreadId;
      const groupId = context.groupId;

      // Inline reply functionality has been removed
    } catch (error) {
      this.logger.error("Error handling inline reply from not found:", error);
      await this.bot.answerCallbackQuery(callbackQuery.id, {
        text: "❌ เกิดข้อผิดพลาด",
      });
    }
  }

  // 🔄 Topic Sync System - Clean up orphaned topics

  async syncTopicsWithTelegram(): Promise<void> {
    this.logger.log(
      `[${new Date().toISOString()}] 🔄 Starting topic sync process...`,
    );

    try {
      const allTopics = await this.topicsService.getAllTopics();
      this.logger.log(
        `[${new Date().toISOString()}] 📊 Found ${allTopics.length} topics in database`,
      );

      let checkedCount = 0;
      let deletedCount = 0;

      for (const topic of allTopics) {
        checkedCount++;
        const exists = await this.checkTopicExists(
          topic.telegramTopicId,
          topic.groupId,
        );

        if (!exists) {
          this.logger.log(
            `[${new Date().toISOString()}] 🗑️ Topic ${topic.telegramTopicId} (${topic.name}) doesn't exist in Telegram - removing from database`,
          );
          await this.topicsService.deleteTopic(
            topic.telegramTopicId,
            topic.groupId,
          );
          deletedCount++;
        }

        // Add delay to avoid rate limiting
        if (checkedCount % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      this.logger.log(
        `[${new Date().toISOString()}] ✅ Topic sync completed: ${checkedCount} checked, ${deletedCount} deleted`,
      );
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error during topic sync:`,
        error,
      );
    }
  }

  async syncTopicsForGroup(groupId: string): Promise<void> {
    this.logger.log(
      `[${new Date().toISOString()}] 🔄 Starting topic sync for group ${groupId}...`,
    );

    try {
      const groupTopics = await this.topicsService.getTopicsByGroup(groupId);
      this.logger.log(
        `[${new Date().toISOString()}] 📊 Found ${groupTopics.length} topics for group ${groupId}`,
      );

      let checkedCount = 0;
      let deletedCount = 0;

      for (const topic of groupTopics) {
        checkedCount++;
        const exists = await this.checkTopicExists(
          topic.telegramTopicId,
          topic.groupId,
        );

        if (!exists) {
          this.logger.log(
            `[${new Date().toISOString()}] 🗑️ Topic ${topic.telegramTopicId} (${topic.name}) doesn't exist - removing from database`,
          );
          await this.topicsService.deleteTopic(
            topic.telegramTopicId,
            topic.groupId,
          );
          deletedCount++;
        }

        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      this.logger.log(
        `[${new Date().toISOString()}] ✅ Group sync completed: ${checkedCount} checked, ${deletedCount} deleted`,
      );
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error during group topic sync:`,
        error,
      );
    }
  }

  private async checkTopicExists(
    topicId: number,
    groupId: string,
  ): Promise<boolean> {
    try {
      // ใช้ silent message ที่จะถูกลบทันที เพื่อตรวจสอบว่า topic มีอยู่หรือไม่
      const testMessage = `🔍`; // ข้อความสั้น ๆ

      this.logger.log(
        `[${new Date().toISOString()}] API Call: sendMessage (validation) - chatId: ${groupId}, topicId: ${topicId}`,
      );

      const startTime = Date.now();
      const result = await this.bot.sendMessage(groupId, testMessage, {
        message_thread_id: topicId,
      });
      const duration = Date.now() - startTime;

      this.logger.log(
        `[${new Date().toISOString()}] API Response: sendMessage (validation) - Duration: ${duration}ms, Topic ${topicId} exists`,
      );

      // ลบข้อความทดสอบทันที
      try {
        await this.bot.deleteMessage(groupId, result.message_id);
      } catch (deleteError) {
        // Ignore delete errors
      }

      return true;
    } catch (error) {
      const isNotFound =
        error.message &&
        (error.message.includes("message thread not found") ||
          error.message.includes("topic not found") ||
          error.message.includes("THREAD_NOT_FOUND"));

      if (isNotFound) {
        this.logger.log(
          `[${new Date().toISOString()}] ❌ Topic ${topicId} not found in Telegram`,
        );
        return false;
      } else {
        this.logger.warn(
          `[${new Date().toISOString()}] ⚠️ Unknown error checking topic ${topicId}: ${error.message}`,
        );
        // ถ้าเป็น error อื่น ๆ ให้ถือว่า topic ยังมีอยู่ (เพื่อความปลอดภัย)
        return true;
      }
    }
  }

  // Command handlers for manual sync
  private async handleSyncTopics(msg: TelegramBot.Message): Promise<void> {
    const chat = msg.chat;
    const user = msg.from;

    if (!user || !chat || chat.type === "private") {
      return;
    }

    try {
      // ตรวจสอบสิทธิ์ admin
      const permissions = await this.checkBotPermissions(chat.id.toString());
      if (!permissions.isAdmin) {
        await this.bot.sendMessage(
          chat.id,
          "❌ Bot ต้องมีสิทธิ์ Admin เพื่อดำเนินการ sync",
        );
        return;
      }

      await this.bot.sendMessage(
        chat.id,
        "🔄 เริ่มต้น topic sync... กรุณารอสักครู่",
      );

      // Sync เฉพาะ group นี้
      await this.syncTopicsForGroup(chat.id.toString());

      await this.bot.sendMessage(
        chat.id,
        "✅ Topic sync เสร็จสิ้น! Topics ที่ไม่มีอยู่จริงได้ถูกลบออกจาก database แล้ว",
      );
    } catch (error) {
      this.logger.error("Error handling sync topics:", error);
      await this.bot.sendMessage(chat.id, "❌ เกิดข้อผิดพลาดในการ sync topics");
    }
  }

  // Phase 4: Attachment & Message Enhancement Features

  async syncAttachmentsToLinkedTopics(
    fromTopicId: number,
    groupId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] 📎 SYNC ATTACHMENTS TO LINKED TOPICS:`,
      );
      this.logger.log(`  - Source topic: ${fromTopicId} in group ${groupId}`);

      // Get all linked topics for this topic - รองรับ cross-group
      let sourceTopic = await this.topicsService.findByTelegramTopicId(
        fromTopicId,
        groupId,
      );

      // ถ้าไม่เจอใน group ปัจจุบัน ให้ค้นหา globally
      if (!sourceTopic) {
        const allTopics =
          await this.topicsService.findByTelegramTopicIdGlobal(fromTopicId);
        sourceTopic =
          allTopics.find((t) => t.groupId === groupId) || allTopics[0];
        if (sourceTopic) {
          this.logger.log(
            `  📍 Found source topic via global search in group ${sourceTopic.groupId}`,
          );
        }
      }

      // ใช้ ticket เป็นตัวกลางหา linked topics
      const linkedTopics = await this.topicsService.getLinkedTopics(
        fromTopicId,
        sourceTopic.groupId,
      );

      if (!sourceTopic || linkedTopics.length === 0) {
        this.logger.log(`  ⚠️ No linked topics found for attachment sync`);
        return;
      }

      this.logger.log(
        `  - Found ${linkedTopics.length} linked topics:`,
        linkedTopics.map((lt) => `${lt.topicId}@${lt.groupId}`).join(", "),
      );

      for (const linkedTopic of linkedTopics) {
        await this.syncAttachmentsToTopic(
          fromTopicId,
          linkedTopic.topicId,
          sourceTopic.groupId,
        );
      }
    } catch (error) {
      this.logger.error("Error syncing attachments to linked topics:", error);
    }
  }

  private async syncAttachmentsToTopic(
    fromTopicId: number,
    toTopicId: number,
    sourceGroupId: string,
  ): Promise<void> {
    try {
      this.logger.log(`    📎 Syncing attachments to topic ${toTopicId}...`);

      // Find target topic to get its groupId (cross-group support)
      let targetTopic = await this.topicsService.findByTelegramTopicId(
        toTopicId,
        sourceGroupId,
      );
      let targetGroupId = sourceGroupId;

      if (!targetTopic) {
        this.logger.log(
          `      📍 Topic ${toTopicId} not found in source group, searching globally...`,
        );
        const allTargetTopics =
          await this.topicsService.findByTelegramTopicIdGlobal(toTopicId);
        if (allTargetTopics.length > 0) {
          targetTopic = allTargetTopics[0];
          targetGroupId = targetTopic.groupId;
          this.logger.log(
            `      ✅ Found target topic in group ${targetGroupId}`,
          );
        } else {
          this.logger.warn(
            `      ⚠️ Target topic ${toTopicId} not found - deleting from database`,
          );
          await this.topicsService.deleteTopicAndRelations(
            toTopicId,
            targetGroupId,
          );
          return;
        }
      }

      // Find unsyncable messages with attachments
      const unsyncedMessages = await this.messagesService.findSyncableMessages(
        fromTopicId,
        toTopicId,
        sourceGroupId,
      );

      for (const message of unsyncedMessages) {
        if (message.hasAttachments && message.attachmentIds.length > 0) {
          await this.forwardMessageWithAttachments(
            message,
            toTopicId,
            targetGroupId,
          );
        }
      }
    } catch (error) {
      // Check if it's a "message thread not found" error and delete topic
      if (error.message && error.message.includes("message thread not found")) {
        this.logger.warn(
          `[${new Date().toISOString()}] 🧹 Topic ${toTopicId} not found - deleting from database`,
        );
        await this.topicsService.deleteTopicAndRelations(
          toTopicId,
          sourceGroupId,
        );
      } else {
        this.logger.error(
          `Error syncing attachments from topic ${fromTopicId} to ${toTopicId}:`,
          error,
        );
      }
    }
  }

  private async forwardMessageWithAttachments(
    message: any,
    toTopicId: number,
    groupId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `      📋 Forwarding message with attachments to topic ${toTopicId} in group ${groupId}`,
      );

      // Get attachment information
      const attachments = await this.attachmentsService.findByMessageId(
        message.telegramMessageId,
        message.groupId,
        message.topicId,
      );

      if (attachments.length === 0) {
        this.logger.log(
          `      ⚠️ No attachments found for message ${message.telegramMessageId}`,
        );
        return;
      }

      // Create sender info for caption
      const senderInfo =
        message.senderFirstName +
        (message.senderLastName ? ` ${message.senderLastName}` : "");

      // Find source topic info - support cross-group
      let fromTopicInfo = await this.topicsService.findByTelegramTopicId(
        message.topicId,
        message.groupId,
      );
      if (!fromTopicInfo) {
        const allFromTopics =
          await this.topicsService.findByTelegramTopicIdGlobal(message.topicId);
        fromTopicInfo = allFromTopics[0];
      }

      // Create sync caption
      let syncCaption = `📎 Synced from 👤 From: ${senderInfo}`;

      if (message.text || message.caption) {
        syncCaption += `\n💬 ${message.text || message.caption}`;
      }

      this.logger.log(
        `      📤 Forwarding ${attachments.length} actual file(s) to topic ${toTopicId}`,
      );

      // Forward each attachment by its type
      for (const attachment of attachments) {
        try {
          await this.forwardAttachmentByType(
            attachment,
            toTopicId,
            groupId,
            syncCaption,
          );
          this.logger.log(
            `        ✅ Forwarded ${attachment.fileType}: ${attachment.fileName}`,
          );
        } catch (attachError) {
          this.logger.error(
            `        ❌ Failed to forward ${attachment.fileType}: ${attachment.fileName}`,
            attachError.message,
          );
          // Continue with other attachments even if one fails
        }
      }

      // Mark message as synced
      await this.messagesService.markAsSynced(
        (message as any)._id.toString(),
        toTopicId,
      );

      this.logger.log(
        `      ✅ Successfully synced message with ${attachments.length} attachments`,
      );
    } catch (error) {
      this.logger.error("Error forwarding message with attachments:", error);

      // Re-throw to let parent handle broken link cleanup
      throw error;
    }
  }

  private async forwardAttachmentByType(
    attachment: any,
    toTopicId: number,
    groupId: string,
    caption: string,
  ): Promise<void> {
    const options = {
      message_thread_id: toTopicId,
      caption:
        caption.length > 1024 ? caption.substring(0, 1021) + "..." : caption, // Telegram caption limit
    };

    this.logger.log(
      `        📎 Forwarding ${attachment.fileType} with fileId: ${attachment.telegramFileId}`,
    );

    switch (attachment.fileType) {
      case "photo":
        await this.withRetry(
          () => this.bot.sendPhoto(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendPhoto",
        );
        break;

      case "sticker":
        // Stickers don't support captions, send caption separately
        await this.withRetry(
          () =>
            this.bot.sendSticker(groupId, attachment.telegramFileId, {
              message_thread_id: toTopicId,
            }),
          3,
          1000,
          "sendSticker",
        );
        if (caption) {
          await this.sendMessageToTopic(groupId, toTopicId, caption);
        }
        break;

      case "video":
        await this.withRetry(
          () => this.bot.sendVideo(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendVideo",
        );
        break;

      case "audio":
        await this.withRetry(
          () => this.bot.sendAudio(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendAudio",
        );
        break;

      case "voice":
        await this.withRetry(
          () => this.bot.sendVoice(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendVoice",
        );
        break;

      case "video_note":
        // Video notes don't support captions, send caption separately
        await this.withRetry(
          () =>
            this.bot.sendVideoNote(groupId, attachment.telegramFileId, {
              message_thread_id: toTopicId,
            }),
          3,
          1000,
          "sendVideoNote",
        );
        if (caption) {
          await this.sendMessageToTopic(groupId, toTopicId, caption);
        }
        break;

      case "animation":
        await this.withRetry(
          () =>
            this.bot.sendAnimation(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendAnimation",
        );
        break;

      case "document":
      default:
        await this.withRetry(
          () =>
            this.bot.sendDocument(groupId, attachment.telegramFileId, options),
          3,
          1000,
          "sendDocument",
        );
        break;
    }
  }

  async generateMessageMetadata(msg: TelegramBot.Message): Promise<any> {
    const metadata: any = {
      messageLength: (msg.text || msg.caption || "").length,
      hasMedia: false,
      mediaTypes: [],
      hasReply: !!msg.reply_to_message,
      hasForward: !!(msg.forward_from || msg.forward_from_chat),
      mentions: [],
      hashtags: [],
      urls: [],
      timestamp: new Date(msg.date * 1000),
    };

    // Check for media types
    if (msg.photo) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("photo");
    }
    if (msg.document) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("document");
    }
    if (msg.video) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("video");
    }
    if (msg.audio) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("audio");
    }
    if (msg.voice) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("voice");
    }
    if (msg.sticker) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("sticker");
    }
    if (msg.animation) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("animation");
    }
    if (msg.video_note) {
      metadata.hasMedia = true;
      metadata.mediaTypes.push("video_note");
    }

    // Extract mentions, hashtags, and URLs from text
    const text = msg.text || msg.caption || "";

    // Extract mentions
    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(text)) !== null) {
      metadata.mentions.push(match[1]);
    }

    // Extract hashtags
    const hashtagRegex = /#(\w+)/g;
    while ((match = hashtagRegex.exec(text)) !== null) {
      metadata.hashtags.push(match[1]);
    }

    // Extract URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    while ((match = urlRegex.exec(text)) !== null) {
      metadata.urls.push(match[1]);
    }

    return metadata;
  }

  // Phase 3: Notification system for mentioned users
  private async notifyMentionedUser(
    targetUser: any,
    ticket: any,
    newTopicId: number,
    groupId: string,
    inviterName: string,
  ): Promise<void> {
    // newTopicId and groupId are kept for future enhancements
    try {
      // พยายามส่งข้อความส่วนตัวให้ user ที่ถูก mention
      const notificationMessage =
        `🔔 คุณถูก mention ใน Ticket Support!\n\n` +
        `🎫 Ticket: ${ticket?.ticketId}\n` +
        `📝 หัวข้อ: ${ticket?.title}\n` +
        `👤 เชิญโดย: ${inviterName}\n\n` +
        `💬 มี Topic ส่วนตัวรอคุณอยู่ในกลุ่ม\n` +
        `🔗 คลิกไปที่กลุ่มและหา Topic: "👤 ${targetUser.firstName || targetUser.username} - ${ticket.ticketId}"\n\n` +
        `✨ เริ่มสนทนาได้เลย!`;

      // ส่งข้อความส่วนตัว (อาจจะส่งไม่ได้ถ้า user ไม่ได้เริ่มสนทนากับ bot)
      await this.bot.sendMessage(targetUser.telegramId, notificationMessage);

      this.logger.log(
        `Successfully sent notification to user ${targetUser.username || targetUser.telegramId}`,
      );
    } catch (error) {
      // ถ้าส่งข้อความส่วนตัวไม่ได้ ไม่ต้อง throw error เพราะเป็นเรื่องปกติ
      this.logger.log(
        `Could not send private message to user ${targetUser.username || targetUser.telegramId}:`,
        error.message,
      );
    }
  }

  // Enhanced message processing with metadata
  private async processMessageWithMetadata(
    msg: TelegramBot.Message,
    topic: any,
  ): Promise<void> {
    try {
      // Generate enhanced metadata
      const metadata = await this.generateMessageMetadata(msg);

      // Save message with enhanced metadata
      await this.saveMessageToDatabase(msg, topic);

      // If message has attachments, sync to linked topics immediately for this specific message
      if (metadata.hasMedia) {
        const messageThreadId = (msg as any).message_thread_id;
        const linkedTopics = await this.topicsService.getLinkedTopics(
          messageThreadId,
          msg.chat?.id.toString() || "",
        );
        if (linkedTopics.length > 0) {
          // Sync attachments for this specific message only
          await this.syncSpecificMessageAttachments(msg, topic, linkedTopics);
        }
      }

      this.logger.log(`Processed message with metadata:`, {
        messageId: msg.message_id,
        mediaTypes: metadata.mediaTypes,
        mentions: metadata.mentions.length,
        hashtags: metadata.hashtags.length,
        urls: metadata.urls.length,
      });
    } catch (error) {
      this.logger.error("Error processing message with metadata:", error);
    }
  }

  private async syncSpecificMessageAttachments(
    msg: TelegramBot.Message,
    topic: any,
    linkedTopics: Array<{ topicId: number; groupId: string }>,
  ): Promise<void> {
    try {
      const messageThreadId = (msg as any).message_thread_id;
      this.logger.log(
        `[${new Date().toISOString()}] 📎 SYNC SPECIFIC MESSAGE ATTACHMENTS:`,
      );
      this.logger.log(
        `  - Message ID: ${msg.message_id} in topic ${messageThreadId}`,
      );
      this.logger.log(
        `  - Target linked topics:`,
        linkedTopics.map((lt) => `${lt.topicId}@${lt.groupId}`),
      );

      // Find the saved message in database
      const savedMessage = await this.messagesService.findByTelegramMessageId(
        msg.message_id,
        msg.chat?.id.toString() || "",
        messageThreadId,
      );

      if (!savedMessage) {
        this.logger.log(
          `  ⚠️ Message ${msg.message_id} not found in database yet - skipping sync`,
        );
        return;
      }

      if (
        !savedMessage.hasAttachments ||
        savedMessage.attachmentIds.length === 0
      ) {
        this.logger.log(
          `  ⚠️ Message ${msg.message_id} has no attachments - skipping sync`,
        );
        return;
      }

      // Sync to each linked topic
      for (const linkedTopic of linkedTopics) {
        this.logger.log(
          `    🎯 Syncing message ${msg.message_id} to topic ${linkedTopic.topicId}@${linkedTopic.groupId}...`,
        );

        // Check if already synced to this topic
        if (
          savedMessage.syncedToTopics &&
          savedMessage.syncedToTopics.includes(linkedTopic.topicId)
        ) {
          this.logger.log(
            `      ⏭️ Already synced to topic ${linkedTopic.topicId} - skipping`,
          );
          continue;
        }

        try {
          // Use the groupId from linkedTopic directly
          const targetGroupId = linkedTopic.groupId;
          const linkedTopicId = linkedTopic.topicId;

          // Forward this specific message's attachments
          await this.forwardMessageWithAttachments(
            savedMessage,
            linkedTopicId,
            targetGroupId,
          );
        } catch (error) {
          // Check if it's a "message thread not found" error and delete topic
          if (
            error.message &&
            error.message.includes("message thread not found")
          ) {
            this.logger.warn(
              `      🧹 Topic ${linkedTopic.topicId}@${linkedTopic.groupId} not found - deleting from database`,
            );
            await this.topicsService.deleteTopicAndRelations(
              linkedTopic.topicId,
              linkedTopic.groupId,
            );
          } else {
            this.logger.error(
              `      ❌ Error syncing to topic ${linkedTopic.topicId}:`,
              error.message,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error("Error syncing specific message attachments:", error);
    }
  }

  private async handleArchive(
    msg: TelegramBot.Message,
    match: RegExpExecArray,
  ) {
    const message = msg;
    const text = message?.text || "";
    const args = text.split(" ").slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === "private") {
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น",
      );
      return;
    }

    // กำหนดค่าเริ่มต้นเป็น 30 วัน
    let maxAgeDays = 30;

    if (args.length > 0) {
      const parsedDays = parseInt(args[0]);
      if (!isNaN(parsedDays) && parsedDays > 0) {
        maxAgeDays = parsedDays;
      } else {
        await this.bot.sendMessage(
          msg.chat.id,
          "❌ จำนวนวันต้องเป็นตัวเลขบวกเท่านั้น\n\n" +
            "📝 ตัวอย่าง: /archive 30 (ลบ topics ที่อายุมากกว่า 30 วัน)",
        );
        return;
      }
    }

    try {
      await this.bot.sendMessage(
        msg.chat.id,
        `🗂️ **เริ่มกระบวนการ Archive**\n\n` +
          `📅 กำลังค้นหา topics ที่อายุมากกว่า ${maxAgeDays} วัน...\n` +
          `⚠️ กรุณารอสักครู่...`,
      );

      // ดึงรายการ topics ทั้งหมดในกลุ่มนี้
      const topics = await this.topicsService.getTopicsByGroup(
        chat.id.toString(),
      );

      if (topics.length === 0) {
        await this.bot.sendMessage(msg.chat.id, "📭 ไม่พบ topics ในกลุ่มนี้");
        return;
      }

      const now = new Date();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000; // แปลงวันเป็น milliseconds

      let archivedCount = 0;
      let unlinkedCount = 0;
      let errorCount = 0;

      for (const topic of topics) {
        try {
          const topicAge = now.getTime() - topic.createdAt.getTime();

          if (topicAge > maxAgeMs) {
            this.logger.log(
              `🗑️ Archiving topic ${topic.telegramTopicId} (${topic.name}) - Age: ${Math.floor(topicAge / (24 * 60 * 60 * 1000))} days`,
            );

            // 1. Unlink topic ก่อน (ถ้ามี linked topics)
            const linkedTopics = await this.topicsService.getLinkedTopics(
              topic.telegramTopicId,
              topic.groupId,
            );
            if (linkedTopics.length > 0) {
              for (const linkedTopic of linkedTopics) {
                try {
                  await this.topicsService.unlinkTopics(
                    topic.telegramTopicId,
                    linkedTopic.topicId,
                    topic.groupId,
                  );
                  unlinkedCount++;
                } catch (unlinkError) {
                  this.logger.error(
                    `Error unlinking topic ${topic.telegramTopicId} from ${linkedTopic.topicId}:`,
                    unlinkError,
                  );
                }
              }
            }

            // 2. ลบ topic จาก Telegram
            try {
              await this.deleteForumTopic(topic.groupId, topic.telegramTopicId);
            } catch (deleteError) {
              this.logger.error(
                `Error deleting topic ${topic.telegramTopicId} from Telegram:`,
                deleteError,
              );
              // ถึงแม้จะลบจาก Telegram ไม่ได้ ก็ยังลบจาก database ต่อไป
            }

            // 3. ลบ topic จาก database
            await this.topicsService.deleteTopic(
              topic.telegramTopicId,
              topic.groupId,
            );
            archivedCount++;

            // หน่วงเวลาเล็กน้อยเพื่อหลีกเลี่ยง rate limit
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        } catch (error) {
          this.logger.error(
            `Error processing topic ${topic.telegramTopicId}:`,
            error,
          );
          errorCount++;
        }
      }

      // ส่งผลลัพธ์
      const resultMessage =
        `✅ **กระบวนการ Archive เสร็จสิ้น**\n\n` +
        `📊 **สรุปผลลัพธ์:**\n` +
        `🗑️ ลบ topics: ${archivedCount} รายการ\n` +
        `🔗 ยกเลิกการเชื่อมโยง: ${unlinkedCount} รายการ\n` +
        `⚠️ ข้อผิดพลาด: ${errorCount} รายการ\n\n` +
        `📅 เกณฑ์อายุ: มากกว่า ${maxAgeDays} วัน\n` +
        `👤 ดำเนินการโดย: ${user.first_name}`;

      await this.bot.sendMessage(msg.chat.id, resultMessage);
    } catch (error) {
      this.logger.error("Error in handleArchive:", error);
      await this.bot.sendMessage(
        msg.chat.id,
        "❌ เกิดข้อผิดพลาดในการ Archive topics",
      );
    }
  }

  // Debug commands
  private async handleDebugSync(msg: TelegramBot.Message) {
    const chat = msg.chat;
    const user = msg.from;

    if (!user || !chat || chat.type === "private") {
      return;
    }

    try {
      await this.bot.sendMessage(msg.chat.id, "🔄 กำลัง sync topics...");

      await this.syncTopicsWithTelegram();

      const topics = await this.topicsService.getTopicsByGroup(
        chat.id.toString(),
      );

      await this.bot.sendMessage(
        msg.chat.id,
        `✅ Sync เสร็จสิ้น\n📊 พบ ${topics.length} topics ในกลุ่มนี้`,
      );
    } catch (error) {
      this.logger.error("Error in handleDebugSync:", error);
      await this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
    }
  }

  private async handleDebugClear(msg: TelegramBot.Message) {
    const chat = msg.chat;
    const user = msg.from;

    if (!user || !chat || chat.type === "private") {
      return;
    }

    try {
      await this.bot.sendMessage(msg.chat.id, "🗑️ กำลังลบ topics ทั้งหมด...");

      // ลบ topics ทั้งหมดในกลุ่มนี้
      const topics = await this.topicsService.getTopicsByGroup(
        chat.id.toString(),
      );
      let deletedCount = 0;
      let failedCount = 0;

      for (const topic of topics) {
        try {
          // ลบ topic จริงใน Telegram
          await this.deleteForumTopic(
            chat.id.toString(),
            topic.telegramTopicId,
          );
          deletedCount++;
        } catch (err) {
          // Topic อาจถูกลบไปแล้วหรือไม่มีสิทธิ์
          this.logger.warn(
            `Failed to delete topic ${topic.telegramTopicId}: ${err.message}`,
          );
          failedCount++;
        }

        // ลบจาก database
        await this.topicsService.deleteTopicAndRelations(
          topic.telegramTopicId,
          chat.id.toString(),
        );
      }

      // ลบ tickets ที่เกี่ยวข้อง
      const tickets = await this.ticketService.findTicketsByGroup(
        chat.id.toString(),
      );
      for (const ticket of tickets) {
        await this.ticketService.closeTicket(ticket.ticketId);
      }

      await this.bot.sendMessage(
        msg.chat.id,
        `✅ ลบเสร็จสิ้น\n🗑️ ลบ ${deletedCount} topics${failedCount > 0 ? ` (${failedCount} ลบไม่ได้)` : ""}\n🎫 ปิด ${tickets.length} tickets`,
      );
    } catch (error) {
      this.logger.error("Error in handleDebugClear:", error);
      await this.bot.sendMessage(msg.chat.id, `❌ Error: ${error.message}`);
    }
  }
}
