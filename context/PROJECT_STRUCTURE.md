# โครงสร้าง Project - Telegram Ticket Support System

## เทคโนโลยีที่ใช้
- **Backend**: NestJS (TypeScript)
- **Database**: MongoDB
- **Bot Framework**: Telegram Bot API
- **Containerization**: Podman (ใช้คำสั่ง docker-compose ได้)

## โครงสร้างโฟลเดอร์

```
topics-telegram-bot/
├── src/
│   ├── modules/
│   │   ├── bot/                  # Telegram Bot Module
│   │   │   ├── bot.module.ts
│   │   │   ├── bot.service.ts
│   │   │   ├── bot.controller.ts
│   │   │   └── handlers/         # Command Handlers
│   │   │       ├── ticket.handler.ts
│   │   │       ├── mention.handler.ts
│   │   │       └── message.handler.ts
│   │   │
│   │   ├── ticket/               # Ticket Management
│   │   │   ├── ticket.module.ts
│   │   │   ├── ticket.service.ts
│   │   │   ├── ticket.controller.ts
│   │   │   └── schemas/
│   │   │       └── ticket.schema.ts
│   │   │
│   │   ├── topics/               # Telegram Topics Management
│   │   │   ├── topics.module.ts
│   │   │   ├── topics.service.ts
│   │   │   └── schemas/
│   │   │       └── topic.schema.ts
│   │   │
│   │   ├── users/                # User Management
│   │   │   ├── users.module.ts
│   │   │   ├── users.service.ts
│   │   │   └── schemas/
│   │   │       └── user.schema.ts
│   │   │
│   │   ├── groups/               # Group Management
│   │   │   ├── groups.module.ts
│   │   │   ├── groups.service.ts
│   │   │   └── schemas/
│   │   │       └── group.schema.ts
│   │   │
│   │   ├── hooks/                # Hook System
│   │   │   ├── hooks.module.ts
│   │   │   ├── hooks.service.ts
│   │   │   ├── hooks.controller.ts
│   │   │   └── schemas/
│   │   │       └── hook.schema.ts
│   │   │
│   │   ├── api/                  # REST API Gateway
│   │   │   ├── api.module.ts
│   │   │   ├── controllers/
│   │   │   │   ├── tickets.controller.ts
│   │   │   │   ├── messages.controller.ts
│   │   │   │   ├── groups.controller.ts
│   │   │   │   └── webhooks.controller.ts
│   │   │   ├── guards/
│   │   │   │   ├── api-key.guard.ts
│   │   │   │   └── rate-limit.guard.ts
│   │   │   ├── dto/
│   │   │   └── schemas/
│   │   │       └── api-key.schema.ts
│   │   │
│   │   └── attachments/          # Attachment Management
│   │       ├── attachments.module.ts
│   │       ├── attachments.service.ts
│   │       └── schemas/
│   │           └── attachment.schema.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── utils/
│   │
│   ├── config/
│   │   ├── database.config.ts
│   │   └── telegram.config.ts
│   │
│   ├── app.module.ts
│   └── main.ts
│
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## ฐานข้อมูล Schema

### 1. User Schema
```typescript
{
  telegramId: string,           // Telegram User ID
  username: string,             // Telegram Username
  firstName?: string,
  lastName?: string,
  isBot: boolean,
  languageCode?: string,
  createdAt: Date,
  updatedAt: Date
}
```

### 2. Group Schema
```typescript
{
  telegramGroupId: string,      // Telegram Group ID
  title: string,                // ชื่อกลุ่ม
  type: string,                 // 'group' | 'supergroup'
  botIsAdmin: boolean,          // Bot มีสิทธิ์ admin หรือไม่
  supportTopicsEnabled: boolean, // เปิดใช้ Topics หรือไม่
  createdAt: Date,
  updatedAt: Date
}
```

### 3. Ticket Schema
```typescript
{
  ticketId: string,             // Unique Ticket ID
  title: string,                // หัวข้อ Ticket
  description?: string,         // รายละเอียด
  status: 'open' | 'closed' | 'pending',
  priority: 'low' | 'medium' | 'high',
  createdBy: string,            // Telegram User ID
  assignedTo?: string,          // ผู้รับผิดชอบ
  groupId: string,              // Group ที่สร้าง Ticket
  topicId?: number,             // Telegram Topic ID
  createdAt: Date,
  updatedAt: Date,
  closedAt?: Date
}
```

### 4. Topic Schema
```typescript
{
  telegramTopicId: number,      // Telegram Topic ID
  name: string,                 // ชื่อ Topic
  groupId: string,              // Group ที่ Topic อยู่
  ticketId?: string,            // Ticket ที่เชื่อมโยง
  linkedTopics: number[],       // Topics ที่เชื่อมโยงกัน (สำหรับ sync message)
  participants: string[],       // User IDs ที่เข้าร่วม
  isActive: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### 5. Message Schema (Enhanced)
```typescript
{
  messageId: number,            // Telegram Message ID
  telegramTopicId: number,      // Topic ที่ข้อความอยู่
  groupId: string,              // Group ID
  senderId: string,             // ผู้ส่ง (Telegram User ID)
  content: string,              // เนื้อหาข้อความ
  messageType: 'text' | 'photo' | 'document' | 'video',

  // Reply Information
  isReply: boolean,
  replyToMessage?: {
    messageId: number,
    text?: string,
    senderName?: string,
    date?: Date
  },

  // Forward Information
  forwardInfo?: {
    isForwarded: boolean,
    forwardFrom?: {
      id: number,
      username?: string,
      firstName?: string,
      lastName?: string,
      isBot?: boolean
    },
    forwardFromChat?: {
      id: number,
      title?: string,
      type: string,
      username?: string
    },
    forwardFromMessageId?: number,
    forwardSignature?: string,
    forwardSenderName?: string,
    forwardDate?: Date
  },

  // Sync Information
  forwardedToTopics: number[],  // Topics ที่ข้อความถูกส่งต่อไป
  syncStatus: 'pending' | 'completed' | 'failed',

  // Attachments
  hasAttachment: boolean,
  attachments?: string[],       // Array of Attachment IDs

  createdAt: Date,
  updatedAt: Date
}
```

### 6. Attachment Schema (New)
```typescript
{
  attachmentId: string,         // Unique Attachment ID
  messageId: number,            // ข้อความที่เกี่ยวข้อง
  telegramFileId: string,       // Telegram File ID
  telegramUniqueId: string,     // Telegram Unique File ID
  type: 'photo' | 'document' | 'video',
  fileName?: string,            // ชื่อไฟล์
  fileSize?: number,            // ขนาดไฟล์ (bytes)
  mimeType?: string,            // MIME type
  width?: number,               // ความกว้าง (สำหรับ image/video)
  height?: number,              // ความสูง (สำหรับ image/video)
  duration?: number,            // ระยะเวลา (สำหรับ video)
  thumbnail?: {
    fileId: string,
    width: number,
    height: number
  },
  localFilePath?: string,       // Path ในเซิร์ฟเวอร์หลังจาก download
  isDownloaded: boolean,        // ดาวน์โหลดแล้วหรือไม่
  downloadAttempts: number,     // จำนวนครั้งที่พยายาม download
  uploadedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### 7. Hook Schema (New)
```typescript
{
  hookId: string,               // Unique Hook ID
  name: string,                 // ชื่อ Hook
  event: 'ticket.created' | 'ticket.closed' | 'message.sent' | 'user.mentioned',
  url: string,                  // Webhook URL
  method: 'GET' | 'POST' | 'PUT', // HTTP Method
  headers?: Record<string, string>, // Custom Headers
  payload?: Record<string, any>, // Custom Payload Template
  isActive: boolean,            // เปิด/ปิดการใช้งาน
  groupId?: string,             // จำกัดเฉพาะ Group
  retryCount: number,           // จำนวนครั้งที่ลองใหม่
  timeout: number,              // Timeout (ms)
  conditions?: string[],        // เงื่อนไขเพิ่มเติม
  lastTriggered?: Date,         // ครั้งล่าสุดที่ trigger
  lastError?: string,           // Error ล่าสุด
  successCount: number,         // จำนวนครั้งที่สำเร็จ
  failureCount: number,         // จำนวนครั้งที่ล้มเหลว
  createdAt: Date,
  updatedAt: Date
}
```

### 8. API Key Schema (New)
```typescript
{
  keyId: string,                // API Key ID
  hashedKey: string,            // Hashed API Key
  name: string,                 // API Key Name/Description
  allowedScopes: string[],      // ['tickets:read', 'tickets:write', 'messages:read']
  allowedGroups?: string[],     // จำกัดการเข้าถึงเฉพาะ Groups
  expiresAt?: Date,            // วันหมดอายุ
  isActive: boolean,           // สถานะใช้งาน
  requestCount: number,        // จำนวนครั้งที่ใช้งาน
  lastUsedAt?: Date,          // ครั้งล่าสุดที่ใช้งาน
  lastUsedIp?: string,        // IP ล่าสุดที่ใช้งาน
  createdBy: string,          // ผู้สร้าง API Key
  createdAt: Date,
  updatedAt: Date
}
```

## สถาปัตยกรรมระบบ

```
External Systems
     ↓ (REST API)
API Gateway ← → Hook System ← → External Webhooks
     ↓               ↓
NestJS Services ← → Event Bus
     ↓               ↓
Telegram Bot API ← → MongoDB
     ↓
Telegram Groups/Topics
```

### Bot Commands
- `/start` - เริ่มใช้งาน Bot
- `/create_ticket <title> [description]` - สร้าง Ticket ใหม่
- `/close_ticket` - ปิด Ticket (ใช้ใน Topic)
- `/mention @username` - เชิญ user ที่มีอยู่ในระบบเข้าร่วม Topic
- `/link_topic <topic_id>` - เชื่อมโยง Topic กับอีก Topic
- `/unlink_topic <topic_id>` - ยกเลิกการเชื่อมโยง

### REST API Endpoints
- `POST /api/v1/tickets` - สร้าง Ticket ผ่าน API
- `GET /api/v1/tickets` - ดูรายการ Tickets
- `GET /api/v1/tickets/:id` - ดูรายละเอียด Ticket
- `PUT /api/v1/tickets/:id` - อัพเดท Ticket
- `POST /api/v1/tickets/:id/close` - ปิด Ticket
- `POST /api/v1/tickets/:id/messages` - ส่งข้อความไปยัง Ticket
- `GET /api/v1/tickets/:id/messages` - ดูข้อความใน Ticket
- `POST /api/v1/tickets/:id/mention` - Mention user ใน Ticket
- `GET /api/v1/groups` - ดูรายการ Groups
- `POST /api/v1/webhooks` - สร้าง Webhook
- `GET /api/v1/webhooks` - ดูรายการ Webhooks

### Hook Events
- `ticket.created` - เมื่อสร้าง Ticket ใหม่
- `ticket.updated` - เมื่ออัพเดท Ticket
- `ticket.closed` - เมื่อปิด Ticket
- `message.sent` - เมื่อส่งข้อความ
- `user.mentioned` - เมื่อมี user ถูก mention
- `topic.created` - เมื่อสร้าง Topic ใหม่
- `error.occurred` - เมื่อเกิด error

### Workflow หลัก
1. **Setup**: User เพิ่ม Bot เข้ากลุ่ม และให้สิทธิ์ admin
2. **Create Ticket**:
   - ทาง Telegram: ใช้คำสั่ง `/create_ticket` -> ระบบสร้าง Topic ใหม่
   - ทาง API: `POST /api/v1/tickets` -> ระบบสร้าง Topic และ trigger hooks
3. **Mention User**: ใน Topic ใช้คำสั่ง `/mention @username` -> เชิญ user ที่มีอยู่ในระบบเข้าร่วม Topic
4. **Topic Conversation**: ผู้ใช้ทุกคนสนทนากันใน Topic เดียวกัน
5. **Hook Integration**: ระบบจะ trigger webhooks เมื่อมี events เกิดขึ้น
6. **API Integration**: ระบบภายนอกสามารถสร้าง tickets, ส่งข้อความ ผ่าน REST API
7. **Close Ticket**: ใช้คำสั่ง `/close_ticket` หรือ API เพื่อปิด Topic และ Ticket