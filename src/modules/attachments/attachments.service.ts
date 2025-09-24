import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Attachment, AttachmentDocument, AttachmentType } from './schemas/attachment.schema';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);
  private readonly uploadDir = './uploads';
  private readonly maxFileSize = 50 * 1024 * 1024; // 50MB
  private readonly allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4', 'video/avi', 'video/quicktime',
    'audio/mpeg', 'audio/wav', 'audio/ogg'
  ];

  constructor(
    @InjectModel(Attachment.name) private attachmentModel: Model<AttachmentDocument>,
  ) {
    this.ensureUploadDirectory();
  }

  private async ensureUploadDirectory(): Promise<void> {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  async saveAttachment(attachmentData: Partial<Attachment>): Promise<Attachment> {
    const attachment = new this.attachmentModel(attachmentData);
    return attachment.save();
  }

  async findByFileId(telegramFileId: string): Promise<Attachment | null> {
    return this.attachmentModel.findOne({ telegramFileId }).exec();
  }

  async findByTopicId(topicId: number, groupId: string): Promise<Attachment[]> {
    return this.attachmentModel
      .find({ topicId, groupId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByTicketId(ticketId: string): Promise<Attachment[]> {
    return this.attachmentModel
      .find({ ticketId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByMessageId(messageId: number, groupId: string, topicId: number): Promise<Attachment[]> {
    return this.attachmentModel
      .find({ messageId, groupId, topicId })
      .exec();
  }

  async markAsDownloaded(telegramFileId: string, localFilePath: string): Promise<void> {
    await this.attachmentModel
      .updateOne(
        { telegramFileId },
        {
          isDownloaded: true,
          localFilePath,
          downloadedAt: new Date()
        }
      )
      .exec();
  }

  async markAsSynced(attachmentId: string, topicId: number): Promise<void> {
    await this.attachmentModel
      .updateOne(
        { _id: attachmentId },
        {
          $set: { isSynced: true },
          $addToSet: { syncedToTopics: topicId }
        }
      )
      .exec();
  }

  async getFileStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    downloadedFiles: number;
    filesByType: Record<AttachmentType, number>;
  }> {
    const stats = await this.attachmentModel.aggregate([
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          totalSize: { $sum: '$fileSize' },
          downloadedFiles: {
            $sum: { $cond: ['$isDownloaded', 1, 0] }
          }
        }
      }
    ]);

    const filesByType = await this.attachmentModel.aggregate([
      {
        $group: {
          _id: '$fileType',
          count: { $sum: 1 }
        }
      }
    ]);

    const typeMap = filesByType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<AttachmentType, number>);

    return {
      totalFiles: stats[0]?.totalFiles || 0,
      totalSize: stats[0]?.totalSize || 0,
      downloadedFiles: stats[0]?.downloadedFiles || 0,
      filesByType: typeMap
    };
  }

  async cleanupOldFiles(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldAttachments = await this.attachmentModel
      .find({
        createdAt: { $lt: cutoffDate },
        isDownloaded: true
      })
      .exec();

    let deletedCount = 0;

    for (const attachment of oldAttachments) {
      try {
        if (attachment.localFilePath) {
          await fs.unlink(attachment.localFilePath);
        }
        if (attachment.thumbnailLocalPath) {
          await fs.unlink(attachment.thumbnailLocalPath);
        }
        await attachment.deleteOne();
        deletedCount++;
      } catch (error) {
        this.logger.error(`Error cleaning up attachment ${attachment._id}:`, error);
      }
    }

    return deletedCount;
  }

  validateFile(fileInfo: any): { isValid: boolean; reason?: string } {
    // Check file size
    if (fileInfo.file_size > this.maxFileSize) {
      return {
        isValid: false,
        reason: `File size ${(fileInfo.file_size / 1024 / 1024).toFixed(2)}MB exceeds limit of ${this.maxFileSize / 1024 / 1024}MB`
      };
    }

    // Check MIME type if available
    if (fileInfo.mime_type && !this.allowedMimeTypes.includes(fileInfo.mime_type)) {
      return {
        isValid: false,
        reason: `File type ${fileInfo.mime_type} is not allowed`
      };
    }

    // Check for dangerous file extensions
    const dangerousExtensions = [
      '.exe', '.bat', '.cmd', '.com', '.pif', '.scr',
      '.vbs', '.js', '.jar', '.app', '.deb', '.pkg', '.dmg'
    ];

    const fileName = fileInfo.file_name || '';
    const fileExtension = path.extname(fileName).toLowerCase();

    if (dangerousExtensions.includes(fileExtension)) {
      return {
        isValid: false,
        reason: `File extension ${fileExtension} is not allowed for security reasons`
      };
    }

    return { isValid: true };
  }

  generateLocalFileName(originalName: string, telegramFileId: string): string {
    const extension = path.extname(originalName);
    const hash = crypto.createHash('md5').update(telegramFileId).digest('hex');
    const timestamp = Date.now();
    return `${timestamp}_${hash}${extension}`;
  }

  getLocalFilePath(fileName: string): string {
    return path.join(this.uploadDir, fileName);
  }

  determineAttachmentType(fileInfo: any): AttachmentType {
    if (fileInfo.photo) return AttachmentType.PHOTO;
    if (fileInfo.document) return AttachmentType.DOCUMENT;
    if (fileInfo.video) return AttachmentType.VIDEO;
    if (fileInfo.audio) return AttachmentType.AUDIO;
    if (fileInfo.sticker) return AttachmentType.STICKER;
    if (fileInfo.animation) return AttachmentType.ANIMATION;
    if (fileInfo.voice) return AttachmentType.VOICE;
    if (fileInfo.video_note) return AttachmentType.VIDEO_NOTE;

    return AttachmentType.DOCUMENT; // Default fallback
  }

  async findSyncableAttachments(fromTopicId: number, toTopicId: number, groupId: string): Promise<Attachment[]> {
    return this.attachmentModel
      .find({
        topicId: fromTopicId,
        groupId,
        syncedToTopics: { $ne: toTopicId }
      })
      .sort({ createdAt: 1 })
      .exec();
  }
}