import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as TelegramBot from 'node-telegram-bot-api';
import { UsersService } from '../users/users.service';
import { GroupsService } from '../groups/groups.service';
import { TicketService } from '../ticket/ticket.service';
import { TopicsService } from '../topics/topics.service';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: TelegramBot;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private groupsService: GroupsService,
    private ticketService: TicketService,
    private topicsService: TopicsService,
  ) {
    const botToken = this.configService.get<string>('telegram.botToken');
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    this.bot = new TelegramBot(botToken, { polling: true });
  }

  async onModuleInit() {
    this.setupCommands();
    console.log('Telegram bot started successfully');
  }

  async createForumTopic(chatId: string, name: string, iconColor?: number, iconCustomEmojiId?: string) {
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

      // Note: createForumTopic might not be available in node-telegram-bot-api
      // Use the _request method to make a raw API call
      const result = await (this.bot as any)._request('createForumTopic', { form: apiParams });
      return result;
    } catch (error) {
      console.error('Error creating forum topic:', error);
      throw error;
    }
  }

  async closeForumTopic(chatId: string, messageThreadId: number) {
    try {
      // Note: closeForumTopic might not be available in node-telegram-bot-api
      const result = await (this.bot as any)._request('closeForumTopic', { 
        form: {
          chat_id: chatId,
          message_thread_id: messageThreadId,
        }
      });
      return result;
    } catch (error) {
      console.error('Error closing forum topic:', error);
      throw error;
    }
  }

  async sendMessageToTopic(chatId: string, messageThreadId: number, text: string, options?: any) {
    try {
      const sendOptions: any = {
        message_thread_id: messageThreadId,
        ...options,
      };

      // Explicitly remove parse_mode to avoid markdown parsing issues
      delete sendOptions.parse_mode;

      console.log('Debug sendOptions before sending:', JSON.stringify(sendOptions, null, 2));
      console.log('Debug text content:', text);

      const result = await this.bot.sendMessage(chatId, text, sendOptions);
      return result;
    } catch (error) {
      console.error('Error sending message to topic:', error);
      throw error;
    }
  }

  async checkBotPermissions(chatId: string): Promise<{ isAdmin: boolean; canManageTopics: boolean }> {
    try {
      const me = await this.bot.getMe();
      const botInfo = await this.bot.getChatMember(chatId, me.id);
      const isAdmin = botInfo.status === 'administrator';

      let canManageTopics = false;
      if (isAdmin && 'can_manage_topics' in botInfo) {
        canManageTopics = (botInfo as any).can_manage_topics === true;
      }

      return { isAdmin, canManageTopics };
    } catch (error) {
      console.error('Error checking bot permissions:', error);
      return { isAdmin: false, canManageTopics: false };
    }
  }

  private setupCommands() {
    this.bot.onText(/\/start/, this.handleStart.bind(this));
    this.bot.onText(/\/create_ticket(.*)/, this.handleCreateTicket.bind(this));
    this.bot.onText(/\/close_ticket/, this.handleCloseTicket.bind(this));
    this.bot.onText(/\/mention(.*)/, this.handleMention.bind(this));
    this.bot.onText(/\/link_topic(.*)/, this.handleLinkTopic.bind(this));
    this.bot.onText(/\/unlink_topic(.*)/, this.handleUnlinkTopic.bind(this));

    this.bot.on('callback_query', this.handleCallbackQuery.bind(this));
    this.bot.on('my_chat_member', this.handleChatMemberUpdate.bind(this));
    this.bot.on('message', this.handleMessage.bind(this));
  }

  private async handleCallbackQuery(callbackQuery: TelegramBot.CallbackQuery) {
    const data = callbackQuery.data;

    if (data?.startsWith('mention:')) {
      if (data === 'mention:cancel') {
        await this.handleMentionCancel(callbackQuery);
      } else {
        const username = data.replace('mention:', '');
        await this.handleMentionCallback(callbackQuery, username);
      }
    } else if (data?.startsWith('mention_action:')) {
      await this.handleMentionActionCallback(callbackQuery, data);
    } else if (data?.startsWith('unlink:')) {
      await this.handleUnlinkCallback(callbackQuery, data);
    } else if (data?.startsWith('user_not_found:')) {
      await this.handleUserNotFoundCallback(callbackQuery, data);
    }
  }

  private async handleMentionActionCallback(callbackQuery: TelegramBot.CallbackQuery, data: string) {
    try {
      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;

      if (!messageThreadId || !chat) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลไม่ครบถ้วน' });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      }

      if (data === 'mention_action:show_users') {
        await this.showUserSelectionMenu(message, messageThreadId, chat.id.toString());
      } else if (data === 'mention_action:inline_reply') {
        await this.handleInlineReplyRequest(callbackQuery, messageThreadId, chat.id.toString());
      }

    } catch (error) {
      console.error('Error handling mention action callback:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async handleInlineReplyRequest(callbackQuery: TelegramBot.CallbackQuery, messageThreadId: number, groupId: string) {
    try {
      const user = callbackQuery.from;
      const chat = callbackQuery.message?.chat;

      if (!user || !chat) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลไม่ครบถ้วน' });
        return;
      }

      // หา topic และ ticket
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, groupId);
      if (!topic || !topic.ticketId) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้' });
        return;
      }

      const ticket = await this.ticketService.findByTicketId(topic.ticketId);
      if (!ticket) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่พบข้อมูล Ticket' });
        return;
      }

      // ส่งข้อความ inline reply
      const inlineReplyMessage =
        `💬 **Inline Reply จาก ${user.first_name}**\n\n` +
        `📋 กรุณาพิมพ์ข้อความถัดไปเพื่อส่งเป็น Inline Reply\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 หัวข้อ: ${ticket.title}\n\n` +
        `💡 ข้อความถัดไปจะถูกส่งเป็น Inline Reply ใน Topic นี้`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        inlineReplyMessage
      );

      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '✅ กรุณาพิมพ์ข้อความถัดไป' });

      // Set flag for next message to be inline reply
      this.setPendingInlineReply(user.id.toString(), messageThreadId, groupId);

    } catch (error) {
      console.error('Error handling inline reply request:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private pendingInlineReplies = new Map<string, { messageThreadId: number; groupId: string; timestamp: number }>();

  private setPendingInlineReply(userId: string, messageThreadId: number, groupId: string) {
    this.pendingInlineReplies.set(userId, {
      messageThreadId,
      groupId,
      timestamp: Date.now()
    });

    // Auto cleanup after 5 minutes
    setTimeout(() => {
      this.pendingInlineReplies.delete(userId);
    }, 5 * 60 * 1000);
  }

  private getPendingInlineReply(userId: string): { messageThreadId: number; groupId: string } | null {
    const pending = this.pendingInlineReplies.get(userId);
    if (pending && Date.now() - pending.timestamp < 5 * 60 * 1000) { // 5 minutes timeout
      return pending;
    }
    this.pendingInlineReplies.delete(userId);
    return null;
  }

  private async handleUnlinkCallback(callbackQuery: TelegramBot.CallbackQuery, data: string) {
    try {
      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;
      const user = callbackQuery.from;

      if (!messageThreadId || !chat || !user) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลไม่ครบถ้วน' });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      }

      const targetTopicId = parseInt(data.replace('unlink:', ''));
      if (isNaN(targetTopicId)) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Topic ID ไม่ถูกต้อง' });
        return;
      }

      // ยกเลิกการเชื่อมโยง
      await this.topicsService.unlinkTopics(messageThreadId, targetTopicId, chat.id.toString());

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔓 **ยกเลิกการเชื่อมโยง Topic**\n\n` +
        `📋 ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความจะไม่ถูกส่งไป Topic ${targetTopicId} อีกต่อไป`;

      await this.sendMessageToTopic(chat.id.toString(), messageThreadId, sourceMessage);

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔓 **การเชื่อมโยงถูกยกเลิก**\n\n` +
        `📋 การเชื่อมโยงกับ Topic ${messageThreadId} ถูกยกเลิกแล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความจาก Topic ${messageThreadId} จะไม่ถูกส่งมาอีกต่อไป`;

      await this.sendMessageToTopic(chat.id.toString(), targetTopicId, targetMessage);

      await this.bot.answerCallbackQuery(callbackQuery.id, { text: `✅ ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} สำเร็จ` });

    } catch (error) {
      console.error('Error handling unlink callback:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async handleMentionCallback(callbackQuery: TelegramBot.CallbackQuery, username: string) {
    try {
      // Delete the original message
      if (callbackQuery.message) {
        await this.bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      }

      const message = callbackQuery.message;
      const messageThreadId = (message as any)?.message_thread_id;
      const chat = message?.chat;
      const user = callbackQuery.from;

      if (!messageThreadId || !chat || !user) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลไม่ครบถ้วน' });
        return;
      }

      // Check topic and ticket
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, chat.id.toString());
      if (!topic || !topic.ticketId) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้' });
        return;
      }

      const ticket = await this.ticketService.findByTicketId(topic.ticketId);
      if (!ticket) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่พบข้อมูล Ticket' });
        return;
      }

      if (ticket.status === 'closed') {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่สามารถเชิญคนเข้า Ticket ที่ปิดแล้ว' });
        return;
      }

      // Find user in system
      const targetUser = await this.usersService.findByUsername(username);
      if (!targetUser) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: `❌ ไม่พบ User: ${username}` });
        return;
      }

      // Check if user is already in topic
      if (topic.participants.includes(targetUser.telegramId)) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: `ℹ️ ${username} อยู่ใน Topic นี้แล้ว` });
        return;
      }

      // Add user as participant
      await this.topicsService.addParticipant(messageThreadId, chat.id.toString(), targetUser.telegramId);

      // Send mention message in topic
      const mentionMessage =
        `✅ เชิญ @${username} เข้าร่วม Ticket แล้ว\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 หัวข้อ: ${ticket.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n\n` +
        `💬 @${username} สามารถสนทนาใน Topic นี้ได้แล้ว`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        mentionMessage
      );

      await this.bot.answerCallbackQuery(callbackQuery.id, { text: `✅ เชิญ ${username} สำเร็จ` });

    } catch (error) {
      console.error('Error handling mention callback:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async handleMentionCancel(callbackQuery: TelegramBot.CallbackQuery) {
    try {
      // Delete message
      if (callbackQuery.message) {
        await this.bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      }
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'ยกเลิกการเชิญผู้ใช้' });
    } catch (error) {
      console.error('Error handling mention cancel:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async handleStart(msg: TelegramBot.Message, match: RegExpExecArray) {
    console.log('handleStart', msg);

    if (msg.chat?.type === 'private') {
      await this.bot.sendMessage(msg.chat.id,
        '👋 สวัสดี! ฉันเป็น Telegram Ticket Support Bot\n\n' +
          '🎫 เพิ่มฉันเข้ากลุ่มและให้สิทธิ์ Admin เพื่อเริ่มใช้งาน\n' +
          '📋 ใช้คำสั่ง /create_ticket เพื่อสร้าง ticket ใหม่'
      );
    } else {
      const user = msg.from;
      if (user) {
        await this.usersService.findOrCreateUser({
          telegramId: user.id.toString(),
          username: user.username || user.first_name || 'Unknown',
          firstName: user.first_name,
          lastName: user.last_name,
          isBot: user.is_bot,
          languageCode: user.language_code,
        });
      }

      await this.bot.sendMessage(msg.chat.id,
        '✅ Bot พร้อมใช้งานในกลุ่มนี้แล้ว!\n\n' +
          '🎫 ใช้ /create_ticket <หัวข้อ> [รายละเอียด] เพื่อสร้าง ticket'
      );
    }
  }

  private async handleCreateTicket(msg: TelegramBot.Message, match: RegExpExecArray) {
    const text = msg.text || '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await this.bot.sendMessage(msg.chat.id,
        '❌ กรุณาระบุหัวข้อ ticket\n\n' +
          '📝 ตัวอย่าง: /create_ticket ปัญหาระบบล็อกอิน ไม่สามารถเข้าใช้งานได้'
      );
      return;
    }

    // แยก title และ description อย่างถูกต้อง
    const titleMatch = text.match(/\/create_ticket\s+(.+)/);
    if (!titleMatch) {
      await this.bot.sendMessage(msg.chat.id, '❌ กรุณาระบุหัวข้อ ticket');
      return;
    }

    const fullText = titleMatch[1];
    const words = fullText.split(' ');
    const title = words[0];
    const description = words.slice(1).join(' ') || undefined;

    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === 'private') {
      await this.bot.sendMessage(msg.chat.id, '❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    try {
      // ตรวจสอบว่าเป็น supergroup และรองรับ topics
      if (chat.type !== 'supergroup') {
        await this.bot.sendMessage(msg.chat.id,
          '❌ Ticket สามารถสร้างได้เฉพาะใน Supergroup ที่เปิดใช้ Topics เท่านั้น\n\n' +
            '🔧 กรุณาอัพเกรดกลุ่มเป็น Supergroup และเปิดใช้ Topics'
        );
        return;
      }

      // ตรวจสอบสิทธิ์ bot ล่าสุด
      const permissions = await this.checkBotPermissions(chat.id.toString());

      if (!permissions.isAdmin) {
        await this.bot.sendMessage(msg.chat.id,
          '❌ ไม่สามารถสร้าง Ticket ได้\n' +
            '🔧 Bot ไม่มีสิทธิ์ Admin ในกลุ่มนี้\n\n' +
            '👤 กรุณาให้ Admin ของกลุ่มตั้งค่าสิทธิ์ให้ Bot'
        );
        return;
      }

      if (!permissions.canManageTopics) {
        await this.bot.sendMessage(msg.chat.id,
          '❌ ไม่สามารถสร้าง Topic ได้\n' +
            '🔧 Bot ไม่มีสิทธิ์จัดการ Topics\n\n' +
            '📋 กรุณาให้ Admin ตั้งค่าสิทธิ์:\n' +
            '• เปิดใช้ Topics ในกลุ่ม\n' +
            '• ให้สิทธิ์ "Manage Topics" กับ Bot'
        );
        return;
      }

      const group = await this.groupsService.findOrCreateGroup({
        telegramGroupId: chat.id.toString(),
        title: (chat as any).title || 'Unknown Group',
        type: chat.type,
        botIsAdmin: permissions.isAdmin,
        supportTopicsEnabled: true,
      });

      // สร้าง ticket ในฐานข้อมูล
      const ticket = await this.ticketService.createTicket({
        title,
        description,
        createdBy: user.id.toString(),
        groupId: chat.id.toString(),
      });

      // สร้าง forum topic
      const topicName = `🎫 ${ticket.ticketId}: ${title}`;
      const topicResult = await this.createForumTopic(chat.id.toString(), topicName);

      if (topicResult && topicResult.message_thread_id) {
        // อัพเดท ticket ด้วย topic ID
        await this.ticketService.linkTicketToTopic(ticket.ticketId, topicResult.message_thread_id);

        // สร้าง topic ใน database
        await this.topicsService.createTopic({
          telegramTopicId: topicResult.message_thread_id,
          name: topicName,
          groupId: chat.id.toString(),
          ticketId: ticket.ticketId,
          participants: [user.id.toString()],
        });

        // ส่งข้อความต้อนรับใน topic
        const welcomeMessage =
          `📋 Ticket: ${ticket.ticketId}\n` +
          `📝 หัวข้อ: ${ticket.title}\n` +
          `👤 สร้างโดย: ${user.first_name}\n` +
          `📅 วันที่: ${new Date().toLocaleString('th-TH')}\n` +
          (description ? `\n📖 รายละเอียด: ${description}\n` : '') +
          `\n⚡ ใช้ /close_ticket เพื่อปิด Ticket` +
          `\n⚡ ใช้ /mention @username เพื่อเชิญคนอื่นเข้าร่วม`;

        await this.sendMessageToTopic(
          chat.id.toString(),
          topicResult.message_thread_id,
          welcomeMessage
        );

        await this.bot.sendMessage(msg.chat.id,
          `✅ สร้าง Ticket สำเร็จ!\n\n` +
            `🎫 Ticket ID: ${ticket.ticketId}\n` +
            `📝 หัวข้อ: ${ticket.title}\n` +
            `📋 Topic: ${topicName}\n` +
            `👤 สร้างโดย: ${user.first_name}\n\n` +
            `💬 กรุณาไปที่ Topic เพื่อสนทนาเกี่ยวกับ Ticket นี้`
        );
      } else {
        throw new Error('Failed to create forum topic');
      }

    } catch (error) {
      console.error('Error creating ticket:', error);

      if (error.message?.includes('CHAT_NOT_MODIFIED') || error.message?.includes('topics')) {
        await this.bot.sendMessage(msg.chat.id,
          '❌ ไม่สามารถสร้าง Topic ได้\n' +
            '🔧 กรุณาตรวจสอบว่า:\n' +
            '• กลุ่มเป็น Supergroup\n' +
            '• เปิดใช้ Topics ในกลุ่ม\n' +
            '• Bot มีสิทธิ์จัดการ Topics'
        );
      } else {
        await this.bot.sendMessage(msg.chat.id,'❌ เกิดข้อผิดพลาดในการสร้าง Ticket กรุณาลองใหม่อีกครั้ง');
      }
    }
  }

  private async handleCloseTicket(msg: TelegramBot.Message, match: RegExpExecArray) {
    const message = msg;
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === 'private') {
      await this.bot.sendMessage(msg.chat.id,'❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    // ตรวจสอบว่าอยู่ใน topic หรือไม่
    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(msg.chat.id,'❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic ของ Ticket เท่านั้น');
      return;
    }

    try {
      // หา ticket จาก topic ID
      const ticket = await this.ticketService.findByTopicId(messageThreadId);
      if (!ticket) {
        await this.bot.sendMessage(msg.chat.id,'❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้');
        return;
      }

      // ตรวจสอบว่า ticket ปิดแล้วหรือไม่
      if (ticket.status === 'closed') {
        await this.bot.sendMessage(msg.chat.id,'ℹ️ Ticket นี้ปิดแล้ว');
        return;
      }

      // ตรวจสอบสิทธิ์ในการปิด ticket (เจ้าของหรือ admin)
      const isCreator = ticket.createdBy === user.id.toString();
      const group = await this.groupsService.findByTelegramGroupId(chat.id.toString());

      if (!isCreator && !group?.botIsAdmin) {
        await this.bot.sendMessage(msg.chat.id,'❌ คุณไม่มีสิทธิ์ปิด Ticket นี้ (เฉพาะผู้สร้าง Ticket เท่านั้น)');
        return;
      }

      // ปิด ticket
      const closedTicket = await this.ticketService.closeTicket(ticket.ticketId);

      // ปิด forum topic
      await this.closeForumTopic(chat.id.toString(), messageThreadId);

      // อัพเดท topic status ใน database
      await this.topicsService.deactivateTopic(messageThreadId, chat.id.toString());

      // คำนวณระยะเวลาที่ ticket เปิดอยู่
      const createdAt = new Date((ticket as any).createdAt);
      const closedAt = new Date();
      const duration = Math.round((closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60)); // ชั่วโมง

      // ส่งข้อความแจ้งการปิด
      const closeMessage =
        `✅ *Ticket ${ticket.ticketId} ได้รับการปิดแล้ว*\n\n` +
        `📅 ปิดเมื่อ: ${closedAt.toLocaleString('th-TH')}\n` +
        `👤 ปิดโดย: ${user.first_name}\n` +
        `⏱️ ระยะเวลาทำงาน: ${duration > 0 ? duration + ' ชั่วโมง' : 'น้อยกว่า 1 ชั่วโมง'}\n\n` +
        `🔒 Topic นี้จะไม่รับข้อความใหม่อีกต่อไป`;

      await this.bot.sendMessage(msg.chat.id, closeMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Error closing ticket:', error);

      if (error.message?.includes('TOPIC_CLOSED')) {
        await this.bot.sendMessage(msg.chat.id,'ℹ️ Topic นี้ปิดแล้ว');
      } else {
        await this.bot.sendMessage(msg.chat.id,'❌ เกิดข้อผิดพลาดในการปิด Ticket กรุณาลองใหม่อีกครั้ง');
      }
    }
  }

  private async handleMention(msg: TelegramBot.Message, match: RegExpExecArray) {
    const message = msg;
    const text = message?.text || '';
    const args = text.split(' ').slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === 'private') {
      await this.bot.sendMessage(msg.chat.id,'❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    // ตรวจสอบว่าอยู่ใน topic หรือไม่
    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(msg.chat.id,'❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic ของ Ticket เท่านั้น');
      return;
    }

    if (args.length === 0) {
      // แสดง reply markup ให้เลือกผู้ใช้ หรือ inline reply
      await this.showMentionOptions(msg, messageThreadId, chat.id.toString());
      return;
    }

    // แยก username (ลบ @ ถ้ามี)
    const targetUsername = args[0].replace('@', '');

    try {
      // หา topic และ ticket
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, chat.id.toString());
      if (!topic || !topic.ticketId) {
        await this.bot.sendMessage(msg.chat.id,'❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้');
        return;
      }

      const ticket = await this.ticketService.findByTicketId(topic.ticketId);
      if (!ticket) {
        await this.bot.sendMessage(msg.chat.id,'❌ ไม่พบข้อมูล Ticket');
        return;
      }

      if (ticket.status === 'closed') {
        await this.bot.sendMessage(msg.chat.id,'❌ ไม่สามารถเชิญคนเข้า Ticket ที่ปิดแล้ว');
        return;
      }

      // ค้นหา user ในระบบ (เฉพาะ internal users)
      const targetUser = await this.usersService.findByUsername(targetUsername);
      if (!targetUser) {
        // แสดง reply markup เมื่อไม่เจอ user
        await this.showUserNotFoundOptions(msg, targetUsername, messageThreadId, chat.id.toString());
        return;
      }

      // ตรวจสอบว่าเป็น internal user (ไม่ใช่ bot)
      if (targetUser.isBot) {
        await this.bot.sendMessage(msg.chat.id,
          `❌ ไม่สามารถเชิญ Bot ได้: ${targetUsername}\n` +
            '👤 สามารถเชิญได้เฉพาะผู้ใช้จริงเท่านั้น'
        );
        return;
      }

      // ตรวจสอบว่า user อยู่ใน topic แล้วหรือไม่
      if (topic.participants.includes(targetUser.telegramId)) {
        await this.bot.sendMessage(msg.chat.id,`ℹ️ ${targetUsername} อยู่ใน Topic นี้แล้ว`);
        return;
      }

      // เพิ่ม user เป็น participant
      await this.topicsService.addParticipant(messageThreadId, chat.id.toString(), targetUser.telegramId);

      // ส่งข้อความแจ้งใน topic
      const mentionMessage =
        `✅ เชิญ @${targetUsername} เข้าร่วม Ticket แล้ว\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📝 หัวข้อ: ${ticket.title}\n` +
        `👤 เชิญโดย: ${user.first_name}\n\n` +
        `💬 @${targetUsername} สามารถสนทนาใน Topic นี้ได้แล้ว`;

      await this.sendMessageToTopic(
        chat.id.toString(),
        messageThreadId,
        mentionMessage
      );

    } catch (error) {
      console.error('Error handling mention:', error);
      await this.bot.sendMessage(msg.chat.id,'❌ เกิดข้อผิดพลาดในการเชิญ User กรุณาลองใหม่อีกครั้ง');
    }
  }

  private async showMentionOptions(msg: TelegramBot.Message, messageThreadId: number, groupId: string) {
    try {
      // แสดงตัวเลือกระหว่าง mention user หรือ inline reply
      const buttons = [
        [
          {
            text: '👥 เชิญผู้ใช้',
            callback_data: 'mention_action:show_users'
          },
          {
            text: '💬 Inline Reply',
            callback_data: 'mention_action:inline_reply'
          }
        ],
        [
          {
            text: '❌ ยกเลิก',
            callback_data: 'mention:cancel'
          }
        ]
      ];

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        '🎯 เลือกการกระทำ:\n\n' +
          '👥 เชิญผู้ใช้ - เชิญ Internal User เข้าร่วม Topic\n' +
          '💬 Inline Reply - ส่งข้อความใน Topic นี้',
        { reply_markup: inlineKeyboard }
      );

    } catch (error) {
      console.error('Error showing mention options:', error);
      await this.bot.sendMessage(msg.chat.id, '❌ เกิดข้อผิดพลาดในการแสดงตัวเลือก');
    }
  }

  private async showUserSelectionMenu(msg: TelegramBot.Message, messageThreadId: number, groupId: string) {
    try {
      // หา topic และ participants ปัจจุบัน
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, groupId);
      if (!topic) {
        await this.bot.sendMessage(msg.chat.id,'❌ ไม่พบข้อมูล Topic');
        return;
      }

      // ค้นหาผู้ใช้ที่สามารถเชิญได้ (ยกเว้นคนที่อยู่ใน topic แล้ว)
      const availableUsers = await this.usersService.findAllActiveUsers(topic.participants);

      if (availableUsers.length === 0) {
        await this.bot.sendMessage(msg.chat.id,
          'ℹ️ ไม่มีผู้ใช้ที่สามารถเชิญได้\n\n' +
            '💡 ผู้ใช้ทุกคนอยู่ใน Topic นี้แล้ว หรือยังไม่มีผู้ใช้ในระบบ'
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
          callback_data: `mention:${user1.username}`
        });

        if (i + 1 < availableUsers.length) {
          const user2 = availableUsers[i + 1];
          const displayName2 = user2.firstName || user2.username;
          row.push({
            text: `👤 ${displayName2}`,
            callback_data: `mention:${user2.username}`
          });
        }

        buttons.push(row);
      }

      // เพิ่มปุ่มยกเลิก
      buttons.push([{
        text: '❌ ยกเลิก',
        callback_data: 'mention:cancel'
      }]);

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `👥 เลือกผู้ใช้ที่ต้องการเชิญเข้าร่วม Topic\n\n` +
          `📋 ผู้ใช้ที่สามารถเชิญได้: ${availableUsers.length} คน`,
        { reply_markup: inlineKeyboard }
      );

    } catch (error) {
      console.error('Error showing user selection menu:', error);
      await this.bot.sendMessage(msg.chat.id,'❌ เกิดข้อผิดพลาดในการแสดงรายชื่อผู้ใช้');
    }
  }



  private async handleChatMemberUpdate(update: any) {
    const chat = update.chat;

    if (update?.new_chat_member?.user?.id) {
      const me = await this.bot.getMe();
      if (update.new_chat_member.user.id === me.id) {
        const status = update.new_chat_member.status;
        const isAdmin = status === 'administrator';

        if (chat) {
          await this.groupsService.findOrCreateGroup({
            telegramGroupId: chat.id.toString(),
            title: chat.title || 'Unknown Group',
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

    if (user && msg.chat?.type !== 'private') {
      // สร้างหรืออัพเดท user ในฐานข้อมูล
      await this.usersService.findOrCreateUser({
        telegramId: user.id.toString(),
        username: user.username || user.first_name || 'Unknown',
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

  private async handleTopicMessage(msg: TelegramBot.Message, messageThreadId: number) {
    const message = msg;
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat) return;

    try {
      // ตรวจสอบว่าเป็น inline reply ที่รอการส่งหรือไม่
      const pendingReply = this.getPendingInlineReply(user.id.toString());
      if (pendingReply && pendingReply.messageThreadId === messageThreadId && pendingReply.groupId === chat.id.toString()) {
        await this.handleInlineReplyMessage(msg, messageThreadId, chat.id.toString());
        return;
      }

      // หา topic ในฐานข้อมูล
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, chat.id.toString());
      if (!topic) return;

      // เพิ่ม user เป็น participant ใน topic (ถ้ายังไม่มี)
      if (!topic.participants.includes(user.id.toString())) {
        await this.topicsService.addParticipant(messageThreadId, chat.id.toString(), user.id.toString());
      }

      // Sync message to linked topics (Phase 3 feature)
      await this.syncMessageToLinkedTopics(msg, topic);

      // บันทึกข้อความใน database (สำหรับ Phase 4)
      console.log(`Message in topic ${messageThreadId}: ${message.text || 'non-text message'}`);

      // ตรวจสอบว่า topic เชื่อมโยงกับ ticket และยังเปิดอยู่หรือไม่
      if (topic.ticketId) {
        const ticket = await this.ticketService.findByTicketId(topic.ticketId);
        if (ticket && ticket.status === 'closed') {
          // แจ้งให้ทราบว่า ticket ปิดแล้ว (บางครั้ง)
          const now = Date.now();
          const lastWarning = (this as any).lastClosedWarning || 0;

          if (now - lastWarning > 60000) { // แจ้งทุก 1 นาที
            await this.bot.sendMessage(msg.chat.id,'ℹ️ Ticket นี้ปิดแล้ว แต่ยังสามารถสนทนาได้');
            (this as any).lastClosedWarning = now;
          }
        }
      }

    } catch (error) {
      console.error('Error handling topic message:', error);
    }
  }

  private async handleInlineReplyMessage(msg: TelegramBot.Message, messageThreadId: number, groupId: string) {
    try {
      const user = msg.from;
      const messageText = msg.text;

      if (!user || !messageText) {
        return;
      }

      // Remove pending inline reply
      this.pendingInlineReplies.delete(user.id.toString());

      // Get topic and ticket info
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, groupId);
      if (!topic || !topic.ticketId) {
        return;
      }

      const ticket = await this.ticketService.findByTicketId(topic.ticketId);
      if (!ticket) {
        return;
      }

      // Send inline reply message
      const inlineReplyMessage =
        `💬 **Inline Reply**\n\n` +
        `📝 ${messageText}\n\n` +
        `👤 จาก: ${user.first_name || user.username || 'ผู้ใช้'}\n` +
        `🎫 Ticket: ${ticket.ticketId}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}`;

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        inlineReplyMessage
      );

      // Sync to linked topics
      const linkedTopics = await this.topicsService.getLinkedTopics(messageThreadId, groupId);
      for (const linkedTopicId of linkedTopics) {
        try {
          const syncMessage =
            `🔗 **Synced Inline Reply**\n\n` +
            `📝 ${messageText}\n\n` +
            `👤 จาก: ${user.first_name || user.username || 'ผู้ใช้'} (Topic อื่น)\n` +
            `🎫 Ticket: ${ticket.ticketId}\n` +
            `📅 ${new Date().toLocaleString('th-TH')}`;

          await this.sendMessageToTopic(groupId, linkedTopicId, syncMessage);
        } catch (error) {
          console.error(`Error syncing inline reply to topic ${linkedTopicId}:`, error);
        }
      }

    } catch (error) {
      console.error('Error handling inline reply message:', error);
    }
  }

  private async syncMessageToLinkedTopics(msg: TelegramBot.Message, sourceTopic: any) {
    try {
      const messageThreadId = (msg as any).message_thread_id;
      const user = msg.from;
      const messageText = msg.text;
      const chat = msg.chat;

      if (!messageThreadId || !user || !messageText || !chat) {
        return;
      }

      // Get linked topics
      const linkedTopics = await this.topicsService.getLinkedTopics(messageThreadId, chat.id.toString());

      if (linkedTopics.length === 0) {
        return;
      }

      // Prepare sync message
      let syncMessage = `🔗 **Synced Message**\n\n`;
      syncMessage += `📝 ${messageText}\n\n`;
      syncMessage += `👤 จาก: ${user.first_name || user.username || 'ผู้ใช้'} (Topic อื่น)\n`;

      if (sourceTopic.ticketId) {
        const ticket = await this.ticketService.findByTicketId(sourceTopic.ticketId);
        if (ticket) {
          syncMessage += `🎫 Ticket: ${ticket.ticketId}\n`;
        }
      }

      syncMessage += `📅 ${new Date().toLocaleString('th-TH')}`;

      // Send to all linked topics
      for (const linkedTopicId of linkedTopics) {
        try {
          await this.sendMessageToTopic(chat.id.toString(), linkedTopicId, syncMessage);
        } catch (error) {
          console.error(`Error syncing message to topic ${linkedTopicId}:`, error);
        }
      }

    } catch (error) {
      console.error('Error syncing message to linked topics:', error);
    }
  }

  private async handleLinkTopic(msg: TelegramBot.Message, match: RegExpExecArray) {
    const message = msg;
    const text = message?.text || '';
    const args = text.split(' ').slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === 'private') {
      await this.bot.sendMessage(msg.chat.id, '❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(msg.chat.id, '❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic เท่านั้น');
      return;
    }

    if (args.length === 0) {
      await this.bot.sendMessage(msg.chat.id,
        '❌ กรุณาระบุ Topic ID ที่ต้องการเชื่อมโยง\n\n' +
          '📝 ตัวอย่าง: /link_topic 123\n' +
          '💡 ใช้คำสั่งในทั้งสอง Topic ที่ต้องการเชื่อมโยง'
      );
      return;
    }

    const targetTopicId = parseInt(args[0]);
    if (isNaN(targetTopicId)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Topic ID ต้องเป็นตัวเลขเท่านั้น');
      return;
    }

    try {
      // ตรวจสอบ topic ต้นทาง
      const sourceTopic = await this.topicsService.findByTelegramTopicId(messageThreadId, chat.id.toString());
      if (!sourceTopic) {
        await this.bot.sendMessage(msg.chat.id, '❌ ไม่พบข้อมูล Topic นี้');
        return;
      }

      // ตรวจสอบ topic ปลายทาง
      const targetTopic = await this.topicsService.findByTelegramTopicId(targetTopicId, chat.id.toString());
      if (!targetTopic) {
        await this.bot.sendMessage(msg.chat.id, `❌ ไม่พบ Topic ID: ${targetTopicId} ในกลุ่มนี้`);
        return;
      }

      // ตรวจสอบว่าเชื่อมโยงแล้วหรือไม่
      const linkedTopics = await this.topicsService.getLinkedTopics(messageThreadId, chat.id.toString());
      if (linkedTopics.includes(targetTopicId)) {
        await this.bot.sendMessage(msg.chat.id, `ℹ️ Topic นี้เชื่อมโยงกับ Topic ${targetTopicId} แล้ว`);
        return;
      }

      // เชื่อมโยง topics
      await this.topicsService.linkTopics(messageThreadId, targetTopicId, chat.id.toString());

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔗 **เชื่อมโยง Topic สำเร็จ**\n\n` +
        `📋 Topic นี้เชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 เชื่อมโยงโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความใน Topic นี้จะถูกส่งไป Topic ${targetTopicId} อัตโนมัติ`;

      await this.sendMessageToTopic(chat.id.toString(), messageThreadId, sourceMessage);

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔗 **Topic ถูกเชื่อมโยง**\n\n` +
        `📋 Topic นี้เชื่อมโยงกับ Topic ${messageThreadId} แล้ว\n` +
        `👤 เชื่อมโยงโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความใน Topic ${messageThreadId} จะถูกส่งมา Topic นี้อัตโนมัติ`;

      await this.sendMessageToTopic(chat.id.toString(), targetTopicId, targetMessage);

    } catch (error) {
      console.error('Error linking topics:', error);
      await this.bot.sendMessage(msg.chat.id, '❌ เกิดข้อผิดพลาดในการเชื่อมโยง Topic');
    }
  }

  private async handleUnlinkTopic(msg: TelegramBot.Message, match: RegExpExecArray) {
    const message = msg;
    const text = message?.text || '';
    const args = text.split(' ').slice(1);
    const user = msg.from;
    const chat = msg.chat;

    if (!user || !chat || chat.type === 'private') {
      await this.bot.sendMessage(msg.chat.id, '❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await this.bot.sendMessage(msg.chat.id, '❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic เท่านั้น');
      return;
    }

    if (args.length === 0) {
      // แสดงรายการ linked topics ที่สามารถยกเลิกได้
      await this.showLinkedTopicsMenu(msg, messageThreadId, chat.id.toString());
      return;
    }

    const targetTopicId = parseInt(args[0]);
    if (isNaN(targetTopicId)) {
      await this.bot.sendMessage(msg.chat.id, '❌ Topic ID ต้องเป็นตัวเลขเท่านั้น');
      return;
    }

    try {
      // ตรวจสอบว่าเชื่อมโยงกันอยู่หรือไม่
      const linkedTopics = await this.topicsService.getLinkedTopics(messageThreadId, chat.id.toString());
      if (!linkedTopics.includes(targetTopicId)) {
        await this.bot.sendMessage(msg.chat.id, `❌ Topic นี้ไม่ได้เชื่อมโยงกับ Topic ${targetTopicId}`);
        return;
      }

      // ยกเลิกการเชื่อมโยง
      await this.topicsService.unlinkTopics(messageThreadId, targetTopicId, chat.id.toString());

      // ส่งข้อความแจ้งใน topic ต้นทาง
      const sourceMessage =
        `🔓 **ยกเลิกการเชื่อมโยง Topic**\n\n` +
        `📋 ยกเลิกการเชื่อมโยงกับ Topic ${targetTopicId} แล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความจะไม่ถูกส่งไป Topic ${targetTopicId} อีกต่อไป`;

      await this.sendMessageToTopic(chat.id.toString(), messageThreadId, sourceMessage);

      // ส่งข้อความแจ้งใน topic ปลายทาง
      const targetMessage =
        `🔓 **การเชื่อมโยงถูกยกเลิก**\n\n` +
        `📋 การเชื่อมโยงกับ Topic ${messageThreadId} ถูกยกเลิกแล้ว\n` +
        `👤 ยกเลิกโดย: ${user.first_name}\n` +
        `📅 ${new Date().toLocaleString('th-TH')}\n\n` +
        `💬 ข้อความจาก Topic ${messageThreadId} จะไม่ถูกส่งมาอีกต่อไป`;

      await this.sendMessageToTopic(chat.id.toString(), targetTopicId, targetMessage);

    } catch (error) {
      console.error('Error unlinking topics:', error);
      await this.bot.sendMessage(msg.chat.id, '❌ เกิดข้อผิดพลาดในการยกเลิกการเชื่อมโยง Topic');
    }
  }

  private async showLinkedTopicsMenu(msg: TelegramBot.Message, messageThreadId: number, groupId: string) {
    try {
      const linkedTopics = await this.topicsService.getLinkedTopics(messageThreadId, groupId);

      if (linkedTopics.length === 0) {
        await this.bot.sendMessage(msg.chat.id,
          'ℹ️ Topic นี้ไม่ได้เชื่อมโยงกับ Topic อื่น\n\n' +
            '🔗 ใช้ /link_topic <topic_id> เพื่อเชื่อมโยง Topic'
        );
        return;
      }

      // สร้าง inline keyboard
      const buttons = [];

      for (const topicId of linkedTopics) {
        buttons.push([{
          text: `🔓 ยกเลิก Topic ${topicId}`,
          callback_data: `unlink:${topicId}`
        }]);
      }

      buttons.push([{
        text: '❌ ยกเลิก',
        callback_data: 'mention:cancel'
      }]);

      const inlineKeyboard = { inline_keyboard: buttons };

      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `🔗 **Topic ที่เชื่อมโยงกัน**\n\n` +
          `📋 Topic นี้เชื่อมโยงกับ ${linkedTopics.length} Topic:\n` +
          linkedTopics.map(id => `• Topic ${id}`).join('\n') + '\n\n' +
          `🔓 เลือก Topic ที่ต้องการยกเลิกการเชื่อมโยง:`,
        { reply_markup: inlineKeyboard }
      );

    } catch (error) {
      console.error('Error showing linked topics menu:', error);
      await this.bot.sendMessage(msg.chat.id, '❌ เกิดข้อผิดพลาดในการแสดงรายการ Topic ที่เชื่อมโยง');
    }
  }

  private async showUserNotFoundOptions(msg: TelegramBot.Message, searchedUsername: string, messageThreadId: number, groupId: string) {
    try {
      // ค้นหา users ที่คล้ายกัน
      const similarUsers = await this.usersService.searchUsersByUsername(searchedUsername, 5);

      const buttons = [];

      // ถ้ามี users ที่คล้ายกัน
      if (similarUsers.length > 0) {
        buttons.push([{
          text: '🔍 ผู้ใช้ที่คล้ายกัน',
          callback_data: 'user_not_found:show_similar'
        }]);
      }

      // เพิ่มตัวเลือกอื่นๆ
      buttons.push([
        {
          text: '👥 เลือกจากรายชื่อทั้งหมด',
          callback_data: 'user_not_found:show_all'
        }
      ]);

      buttons.push([
        {
          text: '💬 Inline Reply แทน',
          callback_data: 'user_not_found:inline_reply'
        }
      ]);

      buttons.push([{
        text: '❌ ยกเลิก',
        callback_data: 'mention:cancel'
      }]);

      const inlineKeyboard = { inline_keyboard: buttons };

      // Store context for callback
      this.setUserNotFoundContext(msg.from?.id.toString(), {
        searchedUsername,
        messageThreadId,
        groupId,
        similarUsers: similarUsers.map(u => ({
          username: u.username,
          firstName: u.firstName,
          telegramId: u.telegramId
        }))
      });

      // ส่งข้อความใน topic ที่กำลังใช้งาน
      await this.sendMessageToTopic(
        groupId,
        messageThreadId,
        `❌ **ไม่พบผู้ใช้: @${searchedUsername}**\n\n` +
          `🔍 สามารถเชิญได้เฉพาะ Internal Users เท่านั้น\n` +
          (similarUsers.length > 0 ? `💡 พบผู้ใช้ที่คล้ายกัน ${similarUsers.length} คน\n\n` : '\n') +
          `เลือกการกระทำ:`,
        { reply_markup: inlineKeyboard }
      );

    } catch (error) {
      console.error('Error showing user not found options:', error);
      await this.bot.sendMessage(msg.chat.id,
        `❌ ไม่พบผู้ใช้ในระบบ: ${searchedUsername}\n` +
          '🔍 สามารถเชิญได้เฉพาะ Internal Users เท่านั้น\n\n' +
          '💡 ผู้ใช้ต้องเคยใช้งาน Bot ในกลุ่มนี้มาก่อน'
      );
    }
  }

  private userNotFoundContexts = new Map<string, {
    searchedUsername: string;
    messageThreadId: number;
    groupId: string;
    similarUsers: Array<{ username: string; firstName?: string; telegramId: string }>;
    timestamp: number;
  }>();

  private setUserNotFoundContext(userId: string, context: any) {
    this.userNotFoundContexts.set(userId, {
      ...context,
      timestamp: Date.now()
    });

    // Auto cleanup after 5 minutes
    setTimeout(() => {
      this.userNotFoundContexts.delete(userId);
    }, 5 * 60 * 1000);
  }

  private getUserNotFoundContext(userId: string) {
    const context = this.userNotFoundContexts.get(userId);
    if (context && Date.now() - context.timestamp < 5 * 60 * 1000) {
      return context;
    }
    this.userNotFoundContexts.delete(userId);
    return null;
  }

  private async handleUserNotFoundCallback(callbackQuery: TelegramBot.CallbackQuery, data: string) {
    try {
      const user = callbackQuery.from;
      const message = callbackQuery.message;

      if (!user || !message) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลไม่ครบถ้วน' });
        return;
      }

      // Delete the original message
      if (callbackQuery.message) {
        await this.bot.deleteMessage(callbackQuery.message.chat.id, callbackQuery.message.message_id).catch(() => {});
      }

      const context = this.getUserNotFoundContext(user.id.toString());
      if (!context) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ข้อมูลหมดอายุแล้ว' });
        return;
      }

      const action = data.replace('user_not_found:', '');

      switch (action) {
        case 'show_similar':
          await this.showSimilarUsers(callbackQuery, context);
          break;
        case 'show_all':
          await this.showAllUsers(callbackQuery, context);
          break;
        case 'inline_reply':
          await this.handleInlineReplyFromNotFound(callbackQuery, context);
          break;
        default:
          await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ การกระทำไม่ถูกต้อง' });
      }

    } catch (error) {
      console.error('Error handling user not found callback:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async showSimilarUsers(callbackQuery: TelegramBot.CallbackQuery, context: any) {
    try {
      const similarUsers = context.similarUsers;

      if (similarUsers.length === 0) {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ ไม่มีผู้ใช้ที่คล้ายกัน' });
        return;
      }

      const buttons = [];

      for (const user of similarUsers) {
        const displayName = user.firstName || user.username;
        buttons.push([{
          text: `👤 ${displayName} (@${user.username})`,
          callback_data: `mention:${user.username}`
        }]);
      }

      buttons.push([{
        text: '🔙 กลับ',
        callback_data: 'user_not_found:back'
      }]);

      buttons.push([{
        text: '❌ ยกเลิก',
        callback_data: 'mention:cancel'
      }]);

      const inlineKeyboard = { inline_keyboard: buttons };

      // ส่งข้อความใน topic ที่กำลังใช้งาน
      await this.sendMessageToTopic(
        context.groupId,
        context.messageThreadId,
        `🔍 **ผู้ใช้ที่คล้ายกับ "@${context.searchedUsername}":**\n\n` +
          `พบ ${similarUsers.length} คน ที่มีชื่อคล้ายกัน:\n\n` +
          `เลือกผู้ใช้ที่ต้องการเชิญ:`,
        { reply_markup: inlineKeyboard }
      );

      await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'แสดงผู้ใช้ที่คล้ายกัน' });

    } catch (error) {
      console.error('Error showing similar users:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async showAllUsers(callbackQuery: TelegramBot.CallbackQuery, context: any) {
    try {
      const messageThreadId = context.messageThreadId;
      const groupId = context.groupId;

      // Use existing showUserSelectionMenu method but send in topic
      const fakeMessage = {
        chat: { id: parseInt(groupId) },
        from: callbackQuery.from,
        message_thread_id: messageThreadId
      } as any;

      await this.showUserSelectionMenu(fakeMessage, messageThreadId, groupId);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'แสดงรายชื่อผู้ใช้ทั้งหมด' });

    } catch (error) {
      console.error('Error showing all users:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }

  private async handleInlineReplyFromNotFound(callbackQuery: TelegramBot.CallbackQuery, context: any) {
    try {
      const messageThreadId = context.messageThreadId;
      const groupId = context.groupId;

      await this.handleInlineReplyRequest(callbackQuery, messageThreadId, groupId);

    } catch (error) {
      console.error('Error handling inline reply from not found:', error);
      await this.bot.answerCallbackQuery(callbackQuery.id, { text: '❌ เกิดข้อผิดพลาด' });
    }
  }
}