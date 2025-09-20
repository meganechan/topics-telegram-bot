# Technical Details - Attachment และ Forwarded Message Handling

## 1. Attachment Handling System

### 1.1 รูปแบบ Attachments ที่รองรับ

```typescript
enum AttachmentType {
  PHOTO = 'photo',
  DOCUMENT = 'document',
  VIDEO = 'video'
}

// รองรับไฟล์เฉพาะประเภทหลักที่จำเป็น
const SUPPORTED_ATTACHMENT_TYPES = ['photo', 'document', 'video'] as const;
```

### 1.2 Attachment Schema (เพิ่มเติม)

```typescript
// attachments.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ timestamps: true })
export class Attachment {
  @Prop({ required: true })
  messageId: number;

  @Prop({ required: true })
  telegramFileId: string;

  @Prop({ required: true })
  telegramUniqueId: string;

  @Prop({ required: true, enum: AttachmentType })
  type: AttachmentType;

  @Prop()
  fileName?: string;

  @Prop()
  fileSize?: number;

  @Prop()
  mimeType?: string;

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop()
  duration?: number; // สำหรับ video/audio

  @Prop()
  thumbnail?: {
    fileId: string;
    width: number;
    height: number;
  };

  @Prop()
  localFilePath?: string; // path ในเซิร์ฟเวอร์หลังจาก download

  @Prop({ default: false })
  isDownloaded: boolean;

  @Prop({ default: Date.now })
  uploadedAt: Date;
}
```

### 1.3 การจัดการ File Download และ Storage

```typescript
// attachments.service.ts
@Injectable()
export class AttachmentsService {
  private readonly maxFileSize = 50 * 1024 * 1024; // 50MB
  private readonly allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif',
    'application/pdf', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  async downloadAndStoreAttachment(
    telegramFileId: string,
    type: AttachmentType,
    messageId: number
  ): Promise<Attachment> {
    try {
      // 1. ดึงข้อมูลไฟล์จาก Telegram
      const fileInfo = await this.bot.telegram.getFile(telegramFileId);

      if (fileInfo.file_size > this.maxFileSize) {
        throw new Error(`File size too large: ${fileInfo.file_size} bytes`);
      }

      // 2. สร้าง unique filename
      const fileExtension = this.getFileExtension(fileInfo.file_path);
      const uniqueFileName = `${Date.now()}_${messageId}${fileExtension}`;
      const storagePath = `uploads/attachments/${uniqueFileName}`;

      // 3. Download ไฟล์
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
      await this.downloadFile(fileUrl, storagePath);

      // 4. บันทึกข้อมูลลง Database
      const attachment = new this.attachmentModel({
        messageId,
        telegramFileId,
        telegramUniqueId: fileInfo.file_unique_id,
        type,
        fileName: fileInfo.file_path?.split('/').pop(),
        fileSize: fileInfo.file_size,
        localFilePath: storagePath,
        isDownloaded: true
      });

      return await attachment.save();

    } catch (error) {
      console.error('Error downloading attachment:', error);
      throw error;
    }
  }

  private async downloadFile(url: string, localPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.writeFile(localPath, Buffer.from(buffer));
  }
}
```

### 1.4 Message Sync สำหรับ Attachments

```typescript
// message-sync.service.ts
async syncAttachmentMessage(
  originalMessage: any,
  fromTopicId: number,
  toTopicId: number,
  groupId: string
): Promise<void> {

  const messageText = originalMessage.caption || '';
  const sender = originalMessage.from.username || originalMessage.from.first_name;

  let syncedMessage = '';
  let mediaToSend = null;

  switch (originalMessage.type) {
    case 'photo':
      const photo = originalMessage.photo[originalMessage.photo.length - 1];
      mediaToSend = { type: 'photo', media: photo.file_id };
      syncedMessage = `📸 รูปภาพจาก ${sender}`;
      break;

    case 'document':
      const doc = originalMessage.document;
      mediaToSend = { type: 'document', media: doc.file_id };
      syncedMessage = `📄 ไฟล์จาก ${sender}: ${doc.file_name}`;
      break;

    case 'video':
      const video = originalMessage.video;
      mediaToSend = { type: 'video', media: video.file_id };
      syncedMessage = `🎥 วิดีโอจาก ${sender}`;
      break;

    case 'voice':
      const voice = originalMessage.voice;
      mediaToSend = { type: 'voice', media: voice.file_id };
      syncedMessage = `🎤 ข้อความเสียงจาก ${sender} (${voice.duration}s)`;
      break;

    case 'audio':
      const audio = originalMessage.audio;
      mediaToSend = { type: 'audio', media: audio.file_id };
      syncedMessage = `🎵 เสียงจาก ${sender}: ${audio.title || 'ไม่มีชื่อ'}`;
      break;

    case 'sticker':
      const sticker = originalMessage.sticker;
      mediaToSend = { type: 'sticker', media: sticker.file_id };
      syncedMessage = `😀 สติ๊กเกอร์จาก ${sender}`;
      break;
  }

  // เพิ่ม caption ถ้ามี
  if (messageText) {
    syncedMessage += `\n💬 "${messageText}"`;
  }

  // เพิ่มเวลา
  const timestamp = new Date().toLocaleString('th-TH');
  syncedMessage += `\n⏰ ${timestamp}`;

  try {
    if (mediaToSend) {
      // ส่งไฟล์พร้อมข้อความ
      await this.bot.telegram.sendMediaGroup(groupId, [
        { ...mediaToSend, caption: syncedMessage }
      ], {
        message_thread_id: toTopicId
      });
    } else {
      // ส่งแค่ข้อความ (สำหรับ type ที่ไม่รองรับ)
      await this.bot.telegram.sendMessage(groupId, syncedMessage, {
        message_thread_id: toTopicId
      });
    }
  } catch (error) {
    console.error('Error syncing attachment:', error);
    // Fallback: ส่งแค่ข้อความแจ้งว่ามี attachment
    await this.bot.telegram.sendMessage(groupId,
      `❌ ไม่สามารถส่ง ${originalMessage.type} จาก ${sender} ได้\n⏰ ${timestamp}`,
      { message_thread_id: toTopicId }
    );
  }
}
```

## 2. Forwarded Message Handling

### 2.1 Forwarded Message Schema

```typescript
// message.schema.ts (เพิ่มเติม)
@Schema({ timestamps: true })
export class Message {
  // ... existing fields ...

  @Prop({ type: Object })
  forwardInfo?: {
    isForwarded: boolean;
    forwardFrom?: {
      id: number;
      username?: string;
      firstName?: string;
      lastName?: string;
      isBot?: boolean;
    };
    forwardFromChat?: {
      id: number;
      title?: string;
      type: string;
      username?: string;
    };
    forwardFromMessageId?: number;
    forwardSignature?: string;
    forwardSenderName?: string; // สำหรับ anonymous forward
    forwardDate?: Date;
  };

  @Prop({ default: false })
  isReply: boolean;

  @Prop()
  replyToMessage?: {
    messageId: number;
    text?: string;
    senderName?: string;
    date?: Date;
  };
}
```

### 2.2 การประมวลผล Forwarded Messages

```typescript
// forward-handler.service.ts
@Injectable()
export class ForwardHandlerService {

  async processForwardedMessage(message: any): Promise<ForwardInfo> {
    const forwardInfo: ForwardInfo = {
      isForwarded: false
    };

    // ตรวจสอบว่าเป็น forwarded message หรือไม่
    if (message.forward_from || message.forward_from_chat || message.forward_sender_name) {
      forwardInfo.isForwarded = true;
      forwardInfo.forwardDate = new Date(message.forward_date * 1000);

      // Forward จาก User
      if (message.forward_from) {
        forwardInfo.forwardFrom = {
          id: message.forward_from.id,
          username: message.forward_from.username,
          firstName: message.forward_from.first_name,
          lastName: message.forward_from.last_name,
          isBot: message.forward_from.is_bot
        };
      }

      // Forward จาก Chat/Channel
      if (message.forward_from_chat) {
        forwardInfo.forwardFromChat = {
          id: message.forward_from_chat.id,
          title: message.forward_from_chat.title,
          type: message.forward_from_chat.type,
          username: message.forward_from_chat.username
        };
      }

      // Forward จาก Anonymous user
      if (message.forward_sender_name) {
        forwardInfo.forwardSenderName = message.forward_sender_name;
      }

      // Signature (สำหรับ channel)
      if (message.forward_signature) {
        forwardInfo.forwardSignature = message.forward_signature;
      }

      if (message.forward_from_message_id) {
        forwardInfo.forwardFromMessageId = message.forward_from_message_id;
      }
    }

    return forwardInfo;
  }

  formatForwardedMessageForSync(
    originalMessage: any,
    forwardInfo: ForwardInfo,
    sender: string
  ): string {
    let messageText = originalMessage.text || originalMessage.caption || '';
    let syncMessage = '';

    if (forwardInfo.isForwarded) {
      syncMessage += '📨 **Forwarded Message**\n';

      // แสดงข้อมูลต้นทาง
      if (forwardInfo.forwardFrom) {
        const fromUser = forwardInfo.forwardFrom;
        const fromName = fromUser.username
          ? `@${fromUser.username}`
          : `${fromUser.firstName} ${fromUser.lastName || ''}`.trim();
        syncMessage += `📤 ส่งต่อจาก: ${fromName}\n`;
      } else if (forwardInfo.forwardFromChat) {
        const fromChat = forwardInfo.forwardFromChat;
        const chatName = fromChat.username
          ? `@${fromChat.username}`
          : fromChat.title;
        syncMessage += `📤 ส่งต่อจาก: ${chatName} (${fromChat.type})\n`;
      } else if (forwardInfo.forwardSenderName) {
        syncMessage += `📤 ส่งต่อจาก: ${forwardInfo.forwardSenderName}\n`;
      }

      // แสดงวันที่ต้นฉบับ
      if (forwardInfo.forwardDate) {
        const originalDate = forwardInfo.forwardDate.toLocaleString('th-TH');
        syncMessage += `📅 วันที่ต้นฉบับ: ${originalDate}\n`;
      }

      syncMessage += `👤 ส่งต่อโดย: ${sender}\n`;
      syncMessage += '─────────────────\n';
    }

    syncMessage += messageText;

    // เพิ่มเวลาปัจจุบัน
    const currentTime = new Date().toLocaleString('th-TH');
    syncMessage += `\n⏰ ${currentTime}`;

    return syncMessage;
  }
}
```

### 2.3 การจัดการ Reply Messages

```typescript
// reply-handler.service.ts
@Injectable()
export class ReplyHandlerService {

  async processReplyMessage(message: any): Promise<ReplyInfo | null> {
    if (!message.reply_to_message) {
      return null;
    }

    const replyTo = message.reply_to_message;

    return {
      messageId: replyTo.message_id,
      text: replyTo.text || replyTo.caption || '[Attachment]',
      senderName: replyTo.from?.username || replyTo.from?.first_name || 'Unknown',
      date: new Date(replyTo.date * 1000)
    };
  }

  formatReplyMessageForSync(
    originalMessage: any,
    replyInfo: ReplyInfo,
    sender: string
  ): string {
    const messageText = originalMessage.text || originalMessage.caption || '';

    let syncMessage = '💬 **Reply Message**\n';
    syncMessage += `↩️ ตอบกลับข้อความของ: ${replyInfo.senderName}\n`;
    syncMessage += `📝 ข้อความเดิม: "${replyInfo.text.substring(0, 100)}${replyInfo.text.length > 100 ? '...' : '"}"\n`;
    syncMessage += `👤 ตอบโดย: ${sender}\n`;
    syncMessage += '─────────────────\n';
    syncMessage += messageText;

    const currentTime = new Date().toLocaleString('th-TH');
    syncMessage += `\n⏰ ${currentTime}`;

    return syncMessage;
  }
}
```

## 3. Enhanced Message Sync Service

```typescript
// enhanced-message-sync.service.ts
@Injectable()
export class EnhancedMessageSyncService {

  async syncComplexMessage(
    originalMessage: any,
    fromTopicId: number,
    toTopicId: number,
    groupId: string
  ): Promise<void> {

    const sender = originalMessage.from.username || originalMessage.from.first_name;

    // 1. ตรวจสอบว่าเป็น forwarded message
    const forwardInfo = await this.forwardHandler.processForwardedMessage(originalMessage);

    // 2. ตรวจสอบว่าเป็น reply message
    const replyInfo = await this.replyHandler.processReplyMessage(originalMessage);

    // 3. ตรวจสอบ attachments
    const hasAttachment = this.hasAttachment(originalMessage);

    let finalMessage = '';

    // สร้างข้อความตามประเภท
    if (forwardInfo.isForwarded) {
      finalMessage = this.forwardHandler.formatForwardedMessageForSync(
        originalMessage, forwardInfo, sender
      );
    } else if (replyInfo) {
      finalMessage = this.replyHandler.formatReplyMessageForSync(
        originalMessage, replyInfo, sender
      );
    } else {
      // ข้อความปกติ
      const messageText = originalMessage.text || originalMessage.caption || '';
      finalMessage = `👤 ${sender}: ${messageText}\n⏰ ${new Date().toLocaleString('th-TH')}`;
    }

    // 4. ส่งข้อความ
    if (hasAttachment) {
      await this.syncAttachmentMessage(originalMessage, fromTopicId, toTopicId, groupId);
      // ส่งข้อความเพิ่มเติมถ้าเป็น forward หรือ reply
      if (forwardInfo.isForwarded || replyInfo) {
        await this.bot.telegram.sendMessage(groupId, finalMessage, {
          message_thread_id: toTopicId,
          parse_mode: 'Markdown'
        });
      }
    } else {
      await this.bot.telegram.sendMessage(groupId, finalMessage, {
        message_thread_id: toTopicId,
        parse_mode: 'Markdown'
      });
    }

    // 5. บันทึกลง database
    await this.saveMessageToDatabase({
      ...originalMessage,
      forwardInfo,
      replyInfo,
      syncedToTopics: [toTopicId]
    });
  }

  private hasAttachment(message: any): boolean {
    return !!(
      message.photo || message.document || message.video ||
      message.audio || message.voice || message.sticker ||
      message.animation || message.video_note
    );
  }
}
```

## 4. Error Handling สำหรับ Complex Messages

```typescript
// error-cases.service.ts
@Injectable()
export class MessageErrorHandlingService {

  async handleAttachmentError(error: any, messageInfo: any): Promise<void> {
    const errorMessage = this.generateErrorMessage(error, messageInfo);

    // ส่งข้อความแจ้งข้อผิดพลาด
    await this.bot.telegram.sendMessage(messageInfo.groupId, errorMessage, {
      message_thread_id: messageInfo.toTopicId
    });

    // Log error
    console.error('Attachment sync error:', {
      error: error.message,
      messageId: messageInfo.messageId,
      fromTopic: messageInfo.fromTopicId,
      toTopic: messageInfo.toTopicId
    });
  }

  private generateErrorMessage(error: any, messageInfo: any): string {
    let errorMsg = '❌ **ไม่สามารถส่งข้อความได้**\n';

    if (error.message.includes('file size')) {
      errorMsg += '📁 ไฟล์มีขนาดใหญ่เกินไป (เกิน 50MB)\n';
    } else if (error.message.includes('file type')) {
      errorMsg += '📄 ประเภทไฟล์ไม่รองรับ\n';
    } else if (error.message.includes('download')) {
      errorMsg += '⬇️ ไม่สามารถดาวน์โหลดไฟล์ได้\n';
    } else if (error.message.includes('permission')) {
      errorMsg += '🔒 Bot ไม่มีสิทธิ์ส่งไฟล์ประเภทนี้\n';
    } else {
      errorMsg += '🔧 เกิดข้อผิดพลาดทางเทคนิค\n';
    }

    errorMsg += `👤 จาก: ${messageInfo.senderName}\n`;
    errorMsg += `⏰ ${new Date().toLocaleString('th-TH')}\n`;
    errorMsg += '\n💡 กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ';

    return errorMsg;
  }
}
```

## 5. Storage และ File Management

```typescript
// file-storage.service.ts
@Injectable()
export class FileStorageService {
  private readonly storagePath = './uploads';
  private readonly maxDiskUsage = 10 * 1024 * 1024 * 1024; // 10GB

  async checkStorageSpace(): Promise<boolean> {
    const stats = await fs.stat(this.storagePath);
    const diskUsage = await this.calculateDirectorySize(this.storagePath);

    return diskUsage < this.maxDiskUsage;
  }

  async cleanupOldFiles(olderThanDays: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldAttachments = await this.attachmentModel.find({
      createdAt: { $lt: cutoffDate },
      isDownloaded: true
    });

    for (const attachment of oldAttachments) {
      try {
        await fs.unlink(attachment.localFilePath);
        attachment.isDownloaded = false;
        attachment.localFilePath = undefined;
        await attachment.save();
      } catch (error) {
        console.error(`Failed to delete file: ${attachment.localFilePath}`, error);
      }
    }
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    let totalSize = 0;

    for (const file of files) {
      const filePath = path.join(dirPath, file.name);
      if (file.isDirectory()) {
        totalSize += await this.calculateDirectorySize(filePath);
      } else {
        const stats = await fs.stat(filePath);
        totalSize += stats.size;
      }
    }

    return totalSize;
  }
}
```

การเพิ่ม technical details เหล่านี้จะทำให้ระบบสามารถจัดการกับ:
- ไฟล์ประเภทต่างๆ ได้อย่างปลอดภัย
- Forwarded messages พร้อมข้อมูลต้นทาง
- Reply messages ที่มีบริบท
- Error handling ที่ครอบคลุม
- การจัดการ storage อย่างมีประสิทธิภาพ