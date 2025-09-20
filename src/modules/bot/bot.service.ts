import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { UsersService } from '../users/users.service';
import { GroupsService } from '../groups/groups.service';
import { TicketService } from '../ticket/ticket.service';
import { TopicsService } from '../topics/topics.service';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: Telegraf;

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
    this.bot = new Telegraf(botToken);
  }

  async onModuleInit() {
    this.setupCommands();
    await this.bot.launch();
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

      const result = await this.bot.telegram.callApi('createForumTopic', apiParams);
      return result;
    } catch (error) {
      console.error('Error creating forum topic:', error);
      throw error;
    }
  }

  async closeForumTopic(chatId: string, messageThreadId: number) {
    try {
      const result = await this.bot.telegram.callApi('closeForumTopic', {
        chat_id: chatId,
        message_thread_id: messageThreadId,
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

      const result = await this.bot.telegram.sendMessage(chatId, text, sendOptions);
      return result;
    } catch (error) {
      console.error('Error sending message to topic:', error);
      throw error;
    }
  }

  async checkBotPermissions(chatId: string): Promise<{ isAdmin: boolean; canManageTopics: boolean }> {
    try {
      const botInfo = await this.bot.telegram.getChatMember(chatId, this.bot.botInfo.id);
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
    this.bot.start(this.handleStart.bind(this));
    this.bot.command('create_ticket', this.handleCreateTicket.bind(this));
    this.bot.command('close_ticket', this.handleCloseTicket.bind(this));
    this.bot.command('mention', this.handleMention.bind(this));

    this.bot.on('my_chat_member', this.handleChatMemberUpdate.bind(this));
    this.bot.on('message', this.handleMessage.bind(this));
  }

  private async handleStart(ctx: Context) {

    console.log('handleStart', ctx);
    if (ctx.chat?.type === 'private') {
      await ctx.reply(
        '👋 สวัสดี! ฉันเป็น Telegram Ticket Support Bot\n\n' +
          '🎫 เพิ่มฉันเข้ากลุ่มและให้สิทธิ์ Admin เพื่อเริ่มใช้งาน\n' +
          '📋 ใช้คำสั่ง /create_ticket เพื่อสร้าง ticket ใหม่',
      );
    } else {
      const user = ctx.from;
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

      await ctx.reply(
        '✅ Bot พร้อมใช้งานในกลุ่มนี้แล้ว!\n\n' +
          '🎫 ใช้ /create_ticket <หัวข้อ> [รายละเอียด] เพื่อสร้าง ticket',
      );
    }
  }

  private async handleCreateTicket(ctx: Context) {
    const message = ctx.message as any;
    const text = message?.text || '';
    const args = text.split(' ').slice(1);

    if (args.length === 0) {
      await ctx.reply(
        '❌ กรุณาระบุหัวข้อ ticket\n\n' +
          '📝 ตัวอย่าง: /create_ticket ปัญหาระบบล็อกอิน ไม่สามารถเข้าใช้งานได้',
      );
      return;
    }

    // แยก title และ description อย่างถูกต้อง
    const titleMatch = text.match(/\/create_ticket\s+(.+)/);
    if (!titleMatch) {
      await ctx.reply('❌ กรุณาระบุหัวข้อ ticket');
      return;
    }

    const fullText = titleMatch[1];
    const words = fullText.split(' ');
    const title = words[0];
    const description = words.slice(1).join(' ') || undefined;

    const user = ctx.from;
    const chat = ctx.chat;

    if (!user || !chat || chat.type === 'private') {
      await ctx.reply('❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    try {
      // ตรวจสอบว่าเป็น supergroup และรองรับ topics
      if (chat.type !== 'supergroup') {
        await ctx.reply(
          '❌ Ticket สามารถสร้างได้เฉพาะใน Supergroup ที่เปิดใช้ Topics เท่านั้น\n\n' +
            '🔧 กรุณาอัพเกรดกลุ่มเป็น Supergroup และเปิดใช้ Topics'
        );
        return;
      }

      // ตรวจสอบสิทธิ์ bot ล่าสุด
      const permissions = await this.checkBotPermissions(chat.id.toString());

      if (!permissions.isAdmin) {
        await ctx.reply(
          '❌ ไม่สามารถสร้าง Ticket ได้\n' +
            '🔧 Bot ไม่มีสิทธิ์ Admin ในกลุ่มนี้\n\n' +
            '👤 กรุณาให้ Admin ของกลุ่มตั้งค่าสิทธิ์ให้ Bot'
        );
        return;
      }

      if (!permissions.canManageTopics) {
        await ctx.reply(
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

        await ctx.reply(
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
        await ctx.reply(
          '❌ ไม่สามารถสร้าง Topic ได้\n' +
            '🔧 กรุณาตรวจสอบว่า:\n' +
            '• กลุ่มเป็น Supergroup\n' +
            '• เปิดใช้ Topics ในกลุ่ม\n' +
            '• Bot มีสิทธิ์จัดการ Topics'
        );
      } else {
        await ctx.reply('❌ เกิดข้อผิดพลาดในการสร้าง Ticket กรุณาลองใหม่อีกครั้ง');
      }
    }
  }

  private async handleCloseTicket(ctx: Context) {
    const message = ctx.message as any;
    const user = ctx.from;
    const chat = ctx.chat;

    if (!user || !chat || chat.type === 'private') {
      await ctx.reply('❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น');
      return;
    }

    // ตรวจสอบว่าอยู่ใน topic หรือไม่
    const messageThreadId = message?.message_thread_id;
    if (!messageThreadId) {
      await ctx.reply('❌ คำสั่งนี้ใช้ได้เฉพาะใน Topic ของ Ticket เท่านั้น');
      return;
    }

    try {
      // หา ticket จาก topic ID
      const ticket = await this.ticketService.findByTopicId(messageThreadId);
      if (!ticket) {
        await ctx.reply('❌ ไม่พบ Ticket ที่เชื่อมโยงกับ Topic นี้');
        return;
      }

      // ตรวจสอบว่า ticket ปิดแล้วหรือไม่
      if (ticket.status === 'closed') {
        await ctx.reply('ℹ️ Ticket นี้ปิดแล้ว');
        return;
      }

      // ตรวจสอบสิทธิ์ในการปิด ticket (เจ้าของหรือ admin)
      const isCreator = ticket.createdBy === user.id.toString();
      const group = await this.groupsService.findByTelegramGroupId(chat.id.toString());

      if (!isCreator && !group?.botIsAdmin) {
        await ctx.reply('❌ คุณไม่มีสิทธิ์ปิด Ticket นี้ (เฉพาะผู้สร้าง Ticket เท่านั้น)');
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

      await ctx.reply(closeMessage, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Error closing ticket:', error);

      if (error.message?.includes('TOPIC_CLOSED')) {
        await ctx.reply('ℹ️ Topic นี้ปิดแล้ว');
      } else {
        await ctx.reply('❌ เกิดข้อผิดพลาดในการปิด Ticket กรุณาลองใหม่อีกครั้ง');
      }
    }
  }

  private async handleMention(ctx: Context) {
    await ctx.reply('🚧 ฟังก์ชัน Mention จะพร้อมใช้งานใน Phase 3');
  }

  private async handleChatMemberUpdate(ctx: Context) {
    const update = ctx.myChatMember;
    const chat = ctx.chat;
    
    if (update?.new_chat_member?.user?.id === ctx.botInfo?.id) {
      const status = update.new_chat_member.status;
      const isAdmin = status === 'administrator';
      
      if (chat) {
        await this.groupsService.findOrCreateGroup({
          telegramGroupId: chat.id.toString(),
          title: (chat as any).title || 'Unknown Group',
          type: chat.type,
          botIsAdmin: isAdmin,
          supportTopicsEnabled: (chat as any).has_topics_enabled || false,
        });
      }
    }
  }

  private async handleMessage(ctx: Context) {
    const message = ctx.message as any;
    const user = ctx.from;

    if (user && ctx.chat?.type !== 'private') {
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
        await this.handleTopicMessage(ctx, messageThreadId);
      }
    }
  }

  private async handleTopicMessage(ctx: Context, messageThreadId: number) {
    const message = ctx.message as any;
    const user = ctx.from;
    const chat = ctx.chat;

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
            await ctx.reply('ℹ️ Ticket นี้ปิดแล้ว แต่ยังสามารถสนทนาได้');
            (this as any).lastClosedWarning = now;
          }
        }
      }

    } catch (error) {
      console.error('Error handling topic message:', error);
    }
  }
}