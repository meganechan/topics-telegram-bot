# Error Handling Cases - Advanced Scenarios

## 1. Attachment Error Scenarios

### 1.1 File Size Limitations

**เคส: ไฟล์ขนาดใหญ่เกิน 50MB**
```typescript
// Error Handler
export class FileSizeError extends Error {
  constructor(actualSize: number, maxSize: number) {
    super(`File size ${(actualSize / 1024 / 1024).toFixed(2)}MB exceeds limit of ${maxSize / 1024 / 1024}MB`);
    this.name = 'FileSizeError';
  }
}

// Usage in AttachmentService
if (fileInfo.file_size > this.maxFileSize) {
  throw new FileSizeError(fileInfo.file_size, this.maxFileSize);
}
```

**การจัดการ:**
```typescript
async handleFileSizeError(error: FileSizeError, messageInfo: any): Promise<void> {
  const errorMessage = `❌ **ไฟล์ขนาดใหญ่เกินไป**
📁 ขนาดไฟล์: ${(error.actualSize / 1024 / 1024).toFixed(2)} MB
⚠️ ขนาดสูงสุดที่รองรับ: ${this.maxFileSize / 1024 / 1024} MB

💡 **วิธีแก้ไข:**
• บีบอัดไฟล์ให้เล็กลง
• แบ่งไฟล์ออกเป็นส่วนเล็กๆ
• ใช้ cloud storage แล้วแชร์ลิงก์

👤 จาก: ${messageInfo.senderName}
⏰ ${new Date().toLocaleString('th-TH')}`;

  await this.sendErrorMessage(messageInfo.groupId, messageInfo.toTopicId, errorMessage);
}
```

### 1.2 File Type Restrictions

**เคส: ไฟล์ประเภทอันตราย**
```typescript
export class UnsafeFileTypeError extends Error {
  constructor(fileName: string, mimeType: string) {
    super(`File type not allowed: ${fileName} (${mimeType})`);
    this.name = 'UnsafeFileTypeError';
  }
}

// ตรวจสอบไฟล์อันตราย
private readonly dangerousExtensions = [
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar', '.app', '.deb', '.pkg', '.dmg'
];

private readonly allowedMimeTypes = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

validateFileType(fileName: string, mimeType: string): void {
  const extension = path.extname(fileName).toLowerCase();

  if (this.dangerousExtensions.includes(extension)) {
    throw new UnsafeFileTypeError(fileName, mimeType);
  }

  if (mimeType && !this.allowedMimeTypes.includes(mimeType)) {
    throw new UnsafeFileTypeError(fileName, mimeType);
  }
}
```

### 1.3 Network และ Download Errors

**เคส: การดาวน์โหลดล้มเหลว**
```typescript
export class DownloadError extends Error {
  constructor(reason: string, retryCount: number) {
    super(`Download failed: ${reason} (Attempt ${retryCount})`);
    this.name = 'DownloadError';
  }
}

async downloadWithRetry(fileUrl: string, localPath: string, maxRetries = 3): Promise<void> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.downloadFile(fileUrl, localPath);
      return; // สำเร็จ
    } catch (error) {
      lastError = error;
      console.warn(`Download attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        // รอก่อนลองใหม่ (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw new DownloadError(lastError.message, maxRetries);
}
```

### 1.4 Storage Space Issues

**เคส: พื้นที่เก็บข้อมูลเต็ม**
```typescript
export class StorageFullError extends Error {
  constructor(requiredSpace: number, availableSpace: number) {
    super(`Insufficient storage: need ${requiredSpace}MB, available ${availableSpace}MB`);
    this.name = 'StorageFullError';
  }
}

async checkStorageBeforeDownload(fileSize: number): Promise<void> {
  const availableSpace = await this.getAvailableStorage();
  const requiredSpace = fileSize + (100 * 1024 * 1024); // เผื่อ 100MB

  if (availableSpace < requiredSpace) {
    // ลองทำความสะอาดไฟล์เก่า
    await this.cleanupOldFiles(7); // ลบไฟล์เก่า 7 วัน

    const newAvailableSpace = await this.getAvailableStorage();
    if (newAvailableSpace < requiredSpace) {
      throw new StorageFullError(
        Math.ceil(requiredSpace / 1024 / 1024),
        Math.ceil(newAvailableSpace / 1024 / 1024)
      );
    }
  }
}
```

## 2. Forwarded Message Error Scenarios

### 2.1 Circular Forward Detection

**เคส: การ forward ข้อความวนลูป**
```typescript
export class CircularForwardError extends Error {
  constructor(messageId: number, topicChain: number[]) {
    super(`Circular forward detected for message ${messageId} in topic chain: ${topicChain.join(' -> ')}`);
    this.name = 'CircularForwardError';
  }
}

private forwardTrackingMap = new Map<number, Set<number>>(); // messageId -> set of topics

async detectCircularForward(messageId: number, fromTopic: number, toTopic: number): Promise<void> {
  if (!this.forwardTrackingMap.has(messageId)) {
    this.forwardTrackingMap.set(messageId, new Set());
  }

  const topicSet = this.forwardTrackingMap.get(messageId);

  if (topicSet.has(toTopic)) {
    const topicChain = Array.from(topicSet);
    topicChain.push(toTopic);
    throw new CircularForwardError(messageId, topicChain);
  }

  topicSet.add(fromTopic);

  // ทำความสะอาดหลัง 1 ชั่วโมง
  setTimeout(() => {
    this.forwardTrackingMap.delete(messageId);
  }, 60 * 60 * 1000);
}
```

### 2.2 Missing Forward Source

**เคส: ไม่สามารถหาต้นทางของ forward ได้**
```typescript
export class MissingForwardSourceError extends Error {
  constructor(messageId: number) {
    super(`Cannot determine forward source for message ${messageId}`);
    this.name = 'MissingForwardSourceError';
  }
}

async handleMissingForwardSource(error: MissingForwardSourceError, messageInfo: any): Promise<void> {
  const errorMessage = `⚠️ **ข้อความส่งต่อไม่สมบูรณ์**

🔍 ไม่สามารถระบุต้นทางของข้อความได้
📨 Message ID: ${error.messageId}

💭 **สาเหตุที่เป็นไปได้:**
• ข้อความต้นฉบับถูกลบแล้ว
• Bot ไม่มีสิทธิ์เข้าถึงแหล่งที่มา
• ข้อความถูกส่งต่อจากแชทส่วนตัว

👤 ส่งต่อโดย: ${messageInfo.senderName}
⏰ ${new Date().toLocaleString('th-TH')}`;

  await this.sendErrorMessage(messageInfo.groupId, messageInfo.toTopicId, errorMessage);
}
```

## 3. Topic Management Errors

### 3.1 Topic Creation Limits

**เคส: เกินขีดจำกัดจำนวน Topics**
```typescript
export class TopicLimitError extends Error {
  constructor(currentCount: number, maxLimit: number) {
    super(`Topic limit exceeded: ${currentCount}/${maxLimit}`);
    this.name = 'TopicLimitError';
  }
}

async checkTopicLimit(groupId: string): Promise<void> {
  const topicCount = await this.topicModel.countDocuments({
    groupId,
    isActive: true
  });

  const maxTopics = 200; // Telegram limit

  if (topicCount >= maxTopics) {
    throw new TopicLimitError(topicCount, maxTopics);
  }
}
```

### 3.2 Topic Permission Errors

**เคส: Bot ไม่มีสิทธิ์จัดการ Topics**
```typescript
export class TopicPermissionError extends Error {
  constructor(action: string, groupId: string) {
    super(`Bot lacks permission to ${action} topics in group ${groupId}`);
    this.name = 'TopicPermissionError';
  }
}

async validateTopicPermissions(groupId: string, action: string): Promise<void> {
  try {
    const chatMember = await this.bot.telegram.getChatMember(groupId, this.bot.botInfo.id);

    if (!chatMember.can_manage_topics) {
      throw new TopicPermissionError(action, groupId);
    }
  } catch (error) {
    throw new TopicPermissionError(action, groupId);
  }
}
```

## 4. Message Sync Errors

### 4.1 Rate Limiting

**เคส: ส่งข้อความเร็วเกินไป**
```typescript
export class RateLimitError extends Error {
  constructor(retryAfter: number) {
    super(`Rate limit exceeded, retry after ${retryAfter} seconds`);
    this.name = 'RateLimitError';
  }
}

private messageQueue = new Map<string, Array<any>>(); // groupId -> message queue
private rateLimitMap = new Map<string, number>(); // groupId -> last message time

async sendMessageWithRateLimit(
  groupId: string,
  message: string,
  options: any
): Promise<void> {
  const now = Date.now();
  const lastMessageTime = this.rateLimitMap.get(groupId) || 0;
  const timeDiff = now - lastMessageTime;

  // Telegram rate limit: 30 messages per second per group
  const minInterval = 1000 / 30; // ~33ms between messages

  if (timeDiff < minInterval) {
    const waitTime = minInterval - timeDiff;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  try {
    await this.bot.telegram.sendMessage(groupId, message, options);
    this.rateLimitMap.set(groupId, Date.now());
  } catch (error) {
    if (error.response?.error_code === 429) {
      const retryAfter = error.response.parameters.retry_after;
      throw new RateLimitError(retryAfter);
    }
    throw error;
  }
}
```

### 4.2 Message Too Long

**เคส: ข้อความยาวเกินขีดจำกัด**
```typescript
export class MessageTooLongError extends Error {
  constructor(messageLength: number, maxLength: number) {
    super(`Message too long: ${messageLength}/${maxLength} characters`);
    this.name = 'MessageTooLongError';
  }
}

async sendLongMessage(
  groupId: string,
  message: string,
  options: any
): Promise<void> {
  const maxLength = 4096; // Telegram limit

  if (message.length <= maxLength) {
    await this.bot.telegram.sendMessage(groupId, message, options);
    return;
  }

  // แบ่งข้อความออกเป็นส่วนๆ
  const chunks = this.splitMessage(message, maxLength - 100); // เผื่อ header

  for (let i = 0; i < chunks.length; i++) {
    const chunkMessage = `📄 **ส่วนที่ ${i + 1}/${chunks.length}**\n\n${chunks[i]}`;

    await this.sendMessageWithRateLimit(groupId, chunkMessage, options);
  }
}

private splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // ถ้าบรรทัดเดียวยาวเกินไป ให้แบ่งเป็นคำ
      if (line.length > maxLength) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + word + ' ').length > maxLength) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
              currentChunk = word + ' ';
            } else {
              // คำเดียวยาวเกินไป ตัดตามตัวอักษร
              chunks.push(word.substring(0, maxLength));
              currentChunk = word.substring(maxLength) + ' ';
            }
          } else {
            currentChunk += word + ' ';
          }
        }
      } else {
        currentChunk = line + '\n';
      }
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
```

## 5. Database และ Concurrency Errors

### 5.1 Duplicate Message Handling

**เคส: ข้อความซ้ำซ้อน**
```typescript
export class DuplicateMessageError extends Error {
  constructor(messageId: number, topicId: number) {
    super(`Duplicate message ${messageId} in topic ${topicId}`);
    this.name = 'DuplicateMessageError';
  }
}

async saveMess ageToDatabase(messageData: any): Promise<void> {
  try {
    // ใช้ upsert เพื่อหลีกเลี่ยงการ duplicate
    await this.messageModel.findOneAndUpdate(
      {
        messageId: messageData.messageId,
        telegramTopicId: messageData.telegramTopicId
      },
      messageData,
      {
        upsert: true,
        setDefaultsOnInsert: true
      }
    );
  } catch (error) {
    if (error.code === 11000) { // MongoDB duplicate key error
      throw new DuplicateMessageError(
        messageData.messageId,
        messageData.telegramTopicId
      );
    }
    throw error;
  }
}
```

### 5.2 Concurrent Topic Creation

**เคส: การสร้าง Topic พร้อมกัน**
```typescript
private topicCreationLocks = new Map<string, Promise<any>>();

async createTopicSafely(
  groupId: string,
  ticketId: string,
  topicName: string
): Promise<number> {
  const lockKey = `${groupId}-${ticketId}`;

  if (this.topicCreationLocks.has(lockKey)) {
    // รอให้การสร้าง topic อื่นเสร็จก่อน
    await this.topicCreationLocks.get(lockKey);
  }

  // ตรวจสอบว่ามี topic อยู่แล้วหรือไม่
  const existingTopic = await this.topicModel.findOne({
    groupId,
    ticketId
  });

  if (existingTopic) {
    return existingTopic.telegramTopicId;
  }

  // สร้าง topic ใหม่
  const creationPromise = this.performTopicCreation(groupId, ticketId, topicName);
  this.topicCreationLocks.set(lockKey, creationPromise);

  try {
    const result = await creationPromise;
    return result;
  } finally {
    this.topicCreationLocks.delete(lockKey);
  }
}
```

## 6. Comprehensive Error Reporting

```typescript
@Injectable()
export class ErrorReportingService {

  async reportError(
    error: Error,
    context: {
      groupId: string;
      topicId?: number;
      userId: string;
      action: string;
      messageData?: any;
    }
  ): Promise<void> {

    // 1. Log error
    console.error('System Error:', {
      error: error.message,
      stack: error.stack,
      context
    });

    // 2. Send user-friendly message
    const userMessage = this.generateUserFriendlyMessage(error, context);
    await this.sendErrorMessage(context.groupId, context.topicId, userMessage);

    // 3. Alert administrators (if critical)
    if (this.isCriticalError(error)) {
      await this.alertAdministrators(error, context);
    }

    // 4. Update error statistics
    await this.updateErrorStats(error.constructor.name, context.action);
  }

  private generateUserFriendlyMessage(error: Error, context: any): string {
    const timestamp = new Date().toLocaleString('th-TH');

    switch (error.constructor.name) {
      case 'FileSizeError':
        return `❌ ไฟล์มีขนาดใหญ่เกินไป\n💡 กรุณาลดขนาดไฟล์หรือใช้ cloud storage\n⏰ ${timestamp}`;

      case 'UnsafeFileTypeError':
        return `⚠️ ไม่อนุญาตให้ส่งไฟล์ประเภทนี้\n🔒 เพื่อความปลอดภัยของระบบ\n⏰ ${timestamp}`;

      case 'TopicLimitError':
        return `📊 จำนวน Topics เต็มแล้ว\n💡 กรุณาปิด Topics เก่าที่ไม่ใช้แล้ว\n⏰ ${timestamp}`;

      case 'RateLimitError':
        return `⏱️ ส่งข้อความเร็วเกินไป\n💡 กรุณารอสักครู่แล้วลองใหม่\n⏰ ${timestamp}`;

      default:
        return `❌ เกิดข้อผิดพลาดทางเทคนิค\n🔧 กรุณาติดต่อผู้ดูแลระบบ\n⏰ ${timestamp}`;
    }
  }
}
```

การเพิ่ม error handling cases เหล่านี้จะทำให้ระบบมีความแข็งแกร่งและสามารถรับมือกับสถานการณ์ที่ผิดปกติได้อย่างเหมาะสม