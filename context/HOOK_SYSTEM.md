# Hook System - Event-Driven Architecture

## 1. Hook System Overview

ระบบ Hook จะทำงานแบบ event-driven โดยจะ trigger เมื่อมี events ต่างๆ เกิดขึ้นในระบบ เช่น การสร้าง ticket, การส่งข้อความ, การปิด ticket เป็นต้น

### 1.1 Hook Types

```typescript
enum HookType {
  // Ticket Events
  TICKET_CREATED = 'ticket.created',
  TICKET_UPDATED = 'ticket.updated',
  TICKET_CLOSED = 'ticket.closed',
  TICKET_REOPENED = 'ticket.reopened',

  // Message Events
  MESSAGE_SENT = 'message.sent',
  MESSAGE_FORWARDED = 'message.forwarded',
  MESSAGE_REPLIED = 'message.replied',

  // Topic Events
  TOPIC_CREATED = 'topic.created',
  TOPIC_LINKED = 'topic.linked',
  TOPIC_UNLINKED = 'topic.unlinked',

  // User Events
  USER_MENTIONED = 'user.mentioned',
  USER_JOINED = 'user.joined',

  // System Events
  BOT_ADDED_TO_GROUP = 'bot.added_to_group',
  ERROR_OCCURRED = 'error.occurred'
}
```

### 1.2 Hook Configuration Schema

```typescript
// hooks.schema.ts
@Schema({ timestamps: true })
export class Hook {
  @Prop({ required: true })
  name: string;                    // ชื่อ Hook

  @Prop({ required: true, enum: HookType })
  event: HookType;                 // Event ที่จะ trigger

  @Prop({ required: true })
  url: string;                     // Webhook URL

  @Prop({ required: true })
  method: 'GET' | 'POST' | 'PUT';  // HTTP Method

  @Prop({ type: Object })
  headers?: Record<string, string>; // Custom Headers

  @Prop({ type: Object })
  payload?: Record<string, any>;   // Custom Payload Template

  @Prop({ default: true })
  isActive: boolean;               // เปิด/ปิดการใช้งาน

  @Prop()
  groupId?: string;                // จำกัดเฉพาะ Group (optional)

  @Prop({ default: 0 })
  retryCount: number;              // จำนวนครั้งที่ลองใหม่

  @Prop({ default: 5000 })
  timeout: number;                 // Timeout (ms)

  @Prop({ type: [String] })
  conditions?: string[];           // เงื่อนไขเพิ่มเติม (JSON Path)

  @Prop()
  lastTriggered?: Date;            // ครั้งล่าสุดที่ trigger

  @Prop()
  lastError?: string;              // Error ล่าสุด

  @Prop({ default: 0 })
  successCount: number;            // จำนวนครั้งที่สำเร็จ

  @Prop({ default: 0 })
  failureCount: number;            // จำนวนครั้งที่ล้มเหลว
}
```

## 2. Hook Event Payloads

### 2.1 Ticket Events

#### TICKET_CREATED
```typescript
interface TicketCreatedPayload {
  event: 'ticket.created';
  timestamp: string;
  data: {
    ticket: {
      ticketId: string;
      title: string;
      description?: string;
      status: string;
      priority: string;
      createdBy: {
        telegramId: string;
        username?: string;
        firstName?: string;
      };
      groupId: string;
      topicId?: number;
      createdAt: string;
    };
    group: {
      telegramGroupId: string;
      title: string;
    };
  };
}
```

#### TICKET_CLOSED
```typescript
interface TicketClosedPayload {
  event: 'ticket.closed';
  timestamp: string;
  data: {
    ticket: {
      ticketId: string;
      title: string;
      status: 'closed';
      closedBy: {
        telegramId: string;
        username?: string;
      };
      closedAt: string;
      duration: number; // ระยะเวลาที่เปิด (minutes)
    };
    messageCount: number;
    participantCount: number;
  };
}
```

### 2.2 Message Events

#### MESSAGE_SENT
```typescript
interface MessageSentPayload {
  event: 'message.sent';
  timestamp: string;
  data: {
    message: {
      messageId: number;
      content: string;
      messageType: 'text' | 'photo' | 'document' | 'video';
      sender: {
        telegramId: string;
        username?: string;
        firstName?: string;
      };
      hasAttachment: boolean;
      isReply: boolean;
      isForwarded: boolean;
    };
    topic: {
      telegramTopicId: number;
      name: string;
      ticketId?: string;
    };
    group: {
      telegramGroupId: string;
      title: string;
    };
  };
}
```

#### USER_MENTIONED
```typescript
interface UserMentionedPayload {
  event: 'user.mentioned';
  timestamp: string;
  data: {
    mentionedUser: {
      username: string;
      telegramId: string;
    };
    mentionedBy: {
      telegramId: string;
      username?: string;
    };
    ticket: {
      ticketId: string;
      title: string;
    };
    topic: {
      telegramTopicId: number;
      name: string;
    };
  };
}
```

## 3. Hook Service Implementation

```typescript
// hooks.service.ts
@Injectable()
export class HooksService {
  constructor(
    @InjectModel(Hook.name) private hookModel: Model<Hook>,
    private httpService: HttpService,
    private configService: ConfigService
  ) {}

  async registerHook(hookData: CreateHookDto): Promise<Hook> {
    // Validate webhook URL
    await this.validateWebhookUrl(hookData.url);

    const hook = new this.hookModel(hookData);
    return await hook.save();
  }

  async triggerHooks(event: HookType, payload: any, groupId?: string): Promise<void> {
    const hooks = await this.getActiveHooks(event, groupId);

    if (hooks.length === 0) {
      return;
    }

    // Process hooks in parallel
    const hookPromises = hooks.map(hook => this.executeHook(hook, payload));
    await Promise.allSettled(hookPromises);
  }

  private async getActiveHooks(event: HookType, groupId?: string): Promise<Hook[]> {
    const query: any = {
      event,
      isActive: true
    };

    if (groupId) {
      query.$or = [
        { groupId: groupId },
        { groupId: { $exists: false } } // Global hooks
      ];
    }

    return await this.hookModel.find(query);
  }

  private async executeHook(hook: Hook, payload: any): Promise<void> {
    try {
      // Check conditions
      if (hook.conditions && !this.checkConditions(hook.conditions, payload)) {
        return;
      }

      // Prepare request
      const requestPayload = this.buildPayload(hook, payload);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Telegram-Ticket-Bot/1.0',
        ...hook.headers
      };

      // Execute with retry
      await this.executeWithRetry(hook, requestPayload, headers);

      // Update success stats
      await this.updateHookStats(hook._id, true);

    } catch (error) {
      console.error(`Hook execution failed: ${hook.name}`, error);
      await this.updateHookStats(hook._id, false, error.message);
    }
  }

  private async executeWithRetry(
    hook: Hook,
    payload: any,
    headers: any
  ): Promise<void> {
    let lastError: Error;

    for (let attempt = 0; attempt <= hook.retryCount; attempt++) {
      try {
        const response = await this.httpService.axiosRef({
          method: hook.method,
          url: hook.url,
          data: hook.method !== 'GET' ? payload : undefined,
          params: hook.method === 'GET' ? payload : undefined,
          headers,
          timeout: hook.timeout
        });

        if (response.status >= 200 && response.status < 300) {
          return; // Success
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      } catch (error) {
        lastError = error;

        if (attempt < hook.retryCount) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  private buildPayload(hook: Hook, eventPayload: any): any {
    if (hook.payload) {
      // Use custom payload template
      return this.replaceVariables(hook.payload, eventPayload);
    }

    // Use default event payload
    return eventPayload;
  }

  private replaceVariables(template: any, data: any): any {
    const templateString = JSON.stringify(template);
    const replacedString = templateString.replace(
      /\\{\\{([^}]+)\\}\\}/g,
      (match, path) => {
        const value = this.getValueByPath(data, path);
        return value !== undefined ? JSON.stringify(value) : match;
      }
    );

    return JSON.parse(replacedString);
  }

  private getValueByPath(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private checkConditions(conditions: string[], payload: any): boolean {
    return conditions.every(condition => {
      // Simple condition checking (can be enhanced)
      const [path, operator, value] = condition.split(' ');
      const actualValue = this.getValueByPath(payload, path);

      switch (operator) {
        case '==': return actualValue == value;
        case '!=': return actualValue != value;
        case '>': return actualValue > Number(value);
        case '<': return actualValue < Number(value);
        case 'contains': return String(actualValue).includes(value);
        default: return true;
      }
    });
  }

  private async updateHookStats(
    hookId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const update: any = {
      lastTriggered: new Date()
    };

    if (success) {
      update.$inc = { successCount: 1 };
      update.$unset = { lastError: 1 };
    } else {
      update.$inc = { failureCount: 1 };
      update.lastError = error;
    }

    await this.hookModel.findByIdAndUpdate(hookId, update);
  }

  private async validateWebhookUrl(url: string): Promise<void> {
    try {
      new URL(url);
      // Additional validation can be added here
    } catch (error) {
      throw new Error('Invalid webhook URL');
    }
  }
}
```

## 4. Hook Integration ใน Services

### 4.1 ใน Ticket Service

```typescript
// ticket.service.ts
@Injectable()
export class TicketService {
  constructor(
    private hooksService: HooksService,
    // ... other dependencies
  ) {}

  async createTicket(ticketData: CreateTicketDto): Promise<Ticket> {
    const ticket = await this.saveTicket(ticketData);
    const topic = await this.createTopic(ticket);

    // Trigger hook
    await this.hooksService.triggerHooks(
      HookType.TICKET_CREATED,
      {
        event: 'ticket.created',
        timestamp: new Date().toISOString(),
        data: {
          ticket: {
            ticketId: ticket.ticketId,
            title: ticket.title,
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            createdBy: await this.getUserInfo(ticket.createdBy),
            groupId: ticket.groupId,
            topicId: topic.telegramTopicId,
            createdAt: ticket.createdAt.toISOString()
          },
          group: await this.getGroupInfo(ticket.groupId)
        }
      },
      ticket.groupId
    );

    return ticket;
  }

  async closeTicket(ticketId: string, closedBy: string): Promise<void> {
    const ticket = await this.findTicket(ticketId);
    const messageCount = await this.getMessageCount(ticketId);
    const duration = this.calculateDuration(ticket.createdAt);

    await this.updateTicketStatus(ticketId, 'closed', closedBy);

    // Trigger hook
    await this.hooksService.triggerHooks(
      HookType.TICKET_CLOSED,
      {
        event: 'ticket.closed',
        timestamp: new Date().toISOString(),
        data: {
          ticket: {
            ticketId: ticket.ticketId,
            title: ticket.title,
            status: 'closed',
            closedBy: await this.getUserInfo(closedBy),
            closedAt: new Date().toISOString(),
            duration
          },
          messageCount,
          participantCount: await this.getParticipantCount(ticketId)
        }
      },
      ticket.groupId
    );
  }
}
```

### 4.2 ใน Message Service

```typescript
// message.service.ts
@Injectable()
export class MessageService {
  constructor(
    private hooksService: HooksService,
    // ... other dependencies
  ) {}

  async handleNewMessage(messageData: any): Promise<void> {
    await this.saveMessage(messageData);

    // Trigger hook
    await this.hooksService.triggerHooks(
      HookType.MESSAGE_SENT,
      {
        event: 'message.sent',
        timestamp: new Date().toISOString(),
        data: {
          message: {
            messageId: messageData.messageId,
            content: messageData.content,
            messageType: messageData.messageType,
            sender: await this.getUserInfo(messageData.senderId),
            hasAttachment: messageData.hasAttachment,
            isReply: messageData.isReply,
            isForwarded: messageData.forwardInfo?.isForwarded || false
          },
          topic: await this.getTopicInfo(messageData.telegramTopicId),
          group: await this.getGroupInfo(messageData.groupId)
        }
      },
      messageData.groupId
    );

    // Sync message to linked topics
    await this.syncMessage(messageData);
  }

  async handleUserMention(mentionData: any): Promise<void> {
    await this.addUserToTopic(mentionData);

    // Trigger hook
    await this.hooksService.triggerHooks(
      HookType.USER_MENTIONED,
      {
        event: 'user.mentioned',
        timestamp: new Date().toISOString(),
        data: {
          mentionedUser: {
            username: mentionData.username,
            telegramId: mentionData.telegramId
          },
          mentionedBy: await this.getUserInfo(mentionData.mentionedBy),
          ticket: await this.getTicketInfo(mentionData.ticketId),
          topic: await this.getTopicInfo(mentionData.topicId)
        }
      },
      mentionData.groupId
    );
  }
}
```

## 5. Hook Management API

```typescript
// hooks.controller.ts
@Controller('hooks')
@UseGuards(AuthGuard)
export class HooksController {
  constructor(private hooksService: HooksService) {}

  @Post()
  async createHook(@Body() createHookDto: CreateHookDto): Promise<Hook> {
    return await this.hooksService.registerHook(createHookDto);
  }

  @Get()
  async getHooks(@Query() query: GetHooksDto): Promise<Hook[]> {
    return await this.hooksService.getHooks(query);
  }

  @Put(':id')
  async updateHook(
    @Param('id') id: string,
    @Body() updateHookDto: UpdateHookDto
  ): Promise<Hook> {
    return await this.hooksService.updateHook(id, updateHookDto);
  }

  @Delete(':id')
  async deleteHook(@Param('id') id: string): Promise<void> {
    return await this.hooksService.deleteHook(id);
  }

  @Post(':id/test')
  async testHook(@Param('id') id: string): Promise<any> {
    return await this.hooksService.testHook(id);
  }

  @Get(':id/stats')
  async getHookStats(@Param('id') id: string): Promise<any> {
    return await this.hooksService.getHookStats(id);
  }
}
```

## 6. ตัวอย่างการใช้งาน Hook

### 6.1 External CRM Integration
```json
{
  "name": "CRM Ticket Sync",
  "event": "ticket.created",
  "url": "https://crm.company.com/api/tickets",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer your_token_here",
    "X-Source": "telegram-bot"
  },
  "payload": {
    "external_id": "{{data.ticket.ticketId}}",
    "title": "{{data.ticket.title}}",
    "description": "{{data.ticket.description}}",
    "priority": "{{data.ticket.priority}}",
    "created_by": "{{data.ticket.createdBy.username}}",
    "source": "telegram"
  }
}
```

### 6.2 Slack Notification
```json
{
  "name": "Slack New Ticket Alert",
  "event": "ticket.created",
  "url": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
  "method": "POST",
  "payload": {
    "text": "🎫 New Ticket Created",
    "attachments": [
      {
        "color": "good",
        "fields": [
          {
            "title": "Ticket ID",
            "value": "{{data.ticket.ticketId}}",
            "short": true
          },
          {
            "title": "Title",
            "value": "{{data.ticket.title}}",
            "short": true
          },
          {
            "title": "Created By",
            "value": "{{data.ticket.createdBy.username}}",
            "short": true
          },
          {
            "title": "Group",
            "value": "{{data.group.title}}",
            "short": true
          }
        ]
      }
    ]
  }
}
```

### 6.3 Analytics Tracking
```json
{
  "name": "Analytics Event",
  "event": "message.sent",
  "url": "https://analytics.company.com/events",
  "method": "POST",
  "conditions": [
    "data.message.hasAttachment == true"
  ],
  "payload": {
    "event_name": "attachment_sent",
    "properties": {
      "ticket_id": "{{data.topic.ticketId}}",
      "message_type": "{{data.message.messageType}}",
      "group_id": "{{data.group.telegramGroupId}}",
      "timestamp": "{{timestamp}}"
    }
  }
}
```

Hook System นี้จะทำให้ระบบสามารถ integrate กับระบบภายนอกได้อย่างยืดหยุ่น และสามารถขยายความสามารถได้ง่ายในอนาคต