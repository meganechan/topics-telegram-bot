import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AttachmentDocument = Attachment & Document;

export enum AttachmentType {
  PHOTO = 'photo',
  DOCUMENT = 'document',
  VIDEO = 'video',
  AUDIO = 'audio',
  STICKER = 'sticker',
  ANIMATION = 'animation',
  VOICE = 'voice',
  VIDEO_NOTE = 'video_note',
}

@Schema({ timestamps: true })
export class Attachment {
  @Prop({ required: true })
  telegramFileId: string;

  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true, enum: AttachmentType })
  fileType: AttachmentType;

  @Prop()
  mimeType?: string;

  @Prop({ required: true })
  fileSize: number;

  @Prop()
  width?: number;

  @Prop()
  height?: number;

  @Prop()
  duration?: number;

  @Prop()
  caption?: string;

  @Prop()
  localFilePath?: string;

  @Prop()
  thumbnailFileId?: string;

  @Prop()
  thumbnailLocalPath?: string;

  @Prop({ required: true })
  uploadedBy: string; // User Telegram ID

  @Prop({ required: true })
  groupId: string; // Group Telegram ID

  @Prop({ required: true })
  topicId: number; // Topic Telegram ID

  @Prop()
  ticketId?: string; // Associated ticket ID

  @Prop({ required: true })
  messageId: number; // Original message ID

  @Prop({ default: false })
  isDownloaded: boolean;

  @Prop()
  downloadedAt?: Date;

  @Prop({ default: false })
  isSynced: boolean;

  @Prop({ type: [Number], default: [] })
  syncedToTopics: number[]; // Topics that received this attachment
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

// Create indexes for better performance
AttachmentSchema.index({ telegramFileId: 1 });
AttachmentSchema.index({ groupId: 1, topicId: 1 });
AttachmentSchema.index({ ticketId: 1 });
AttachmentSchema.index({ messageId: 1 });
AttachmentSchema.index({ uploadedBy: 1 });
AttachmentSchema.index({ fileType: 1 });
AttachmentSchema.index({ createdAt: -1 });