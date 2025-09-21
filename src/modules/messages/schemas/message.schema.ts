import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

export enum MessageType {
  TEXT = 'text',
  PHOTO = 'photo',
  DOCUMENT = 'document',
  VIDEO = 'video',
  AUDIO = 'audio',
  STICKER = 'sticker',
  ANIMATION = 'animation',
  VOICE = 'voice',
  VIDEO_NOTE = 'video_note',
  FORWARD = 'forward',
  REPLY = 'reply',
  SYSTEM = 'system',
}

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true })
  telegramMessageId: number;

  @Prop({ required: true, enum: MessageType })
  messageType: MessageType;

  @Prop()
  text?: string;

  @Prop()
  caption?: string;

  @Prop({ required: true })
  senderId: string; // User Telegram ID

  @Prop({ required: true })
  senderUsername?: string;

  @Prop({ required: true })
  senderFirstName?: string;

  @Prop()
  senderLastName?: string;

  @Prop({ required: true })
  groupId: string; // Group Telegram ID

  @Prop({ required: true })
  topicId: number; // Topic Telegram ID

  @Prop()
  ticketId?: string; // Associated ticket ID

  // Reply information
  @Prop()
  replyToMessageId?: number;

  @Prop()
  replyToText?: string;

  @Prop()
  replyToSender?: string;

  // Forward information
  @Prop()
  forwardFromChatId?: string;

  @Prop()
  forwardFromMessageId?: number;

  @Prop()
  forwardFromSender?: string;

  @Prop()
  forwardDate?: Date;

  // Attachment information
  @Prop({ type: [String], default: [] })
  attachmentIds: string[]; // References to Attachment documents

  @Prop({ default: false })
  hasAttachments: boolean;

  // Sync information
  @Prop({ default: false })
  isSynced: boolean;

  @Prop({ type: [Number], default: [] })
  syncedToTopics: number[]; // Topics that received this message

  @Prop({ default: false })
  isSystemMessage: boolean;

  @Prop()
  editDate?: Date;

  @Prop({ default: false })
  isEdited: boolean;

  @Prop({ default: false })
  isDeleted: boolean;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Create indexes for better performance
MessageSchema.index({ telegramMessageId: 1, groupId: 1, topicId: 1 }, { unique: true });
MessageSchema.index({ ticketId: 1 });
MessageSchema.index({ senderId: 1 });
MessageSchema.index({ groupId: 1, topicId: 1 });
MessageSchema.index({ createdAt: -1 });
MessageSchema.index({ replyToMessageId: 1 });
MessageSchema.index({ forwardFromMessageId: 1 });