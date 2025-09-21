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
      // แสดง reply markup ให้เลือกผู้ใช้
      await this.showUserSelectionMenu(msg, messageThreadId, chat.id.toString());
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

      // ค้นหา user ในระบบ
      const targetUser = await this.usersService.findByUsername(targetUsername);
      if (!targetUser) {
        await this.bot.sendMessage(msg.chat.id,
          `❌ ไม่พบ User: ${targetUsername}\n` +
            '🔍 กรุณาตรวจสอบ username ให้ถูกต้อง\n\n' +
            '💡 User ต้องเคยใช้งาน Bot ในกลุ่มนี้มาก่อน'
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

      await this.bot.sendMessage(msg.chat.id,
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
      // หา topic ในฐานข้อมูล
      const topic = await this.topicsService.findByTelegramTopicId(messageThreadId, chat.id.toString());
      if (!topic) return;

      // เพิ่ม user เป็น participant ใน topic (ถ้ายังไม่มี)
      if (!topic.participants.includes(user.id.toString())) {
        await this.topicsService.addParticipant(messageThreadId, chat.id.toString(), user.id.toString());
      }

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
}