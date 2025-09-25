import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TopicDocument = Topic & Document;

@Schema({ timestamps: true })
export class Topic {
  @Prop({ required: true })
  telegramTopicId: number;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  groupId: string; // Group Telegram ID

  @Prop({ required: true })
  ticketId: string; // Ticket ID - ตอนนี้เป็น required

  // ลบ linkedTopics ออก เพราะจะใช้ ticket เป็นตัวกลางแทน
  // linkedTopics จะถูกคำนวณจาก topics ที่มี ticketId เดียวกัน

  // ลบ participants ออกจาก topic เพราะจะเก็บที่ ticket level

  @Prop()
  createdBy?: string; // User Telegram ID who created this topic

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  isPrimary: boolean; // topic หลักของ ticket

  // เพิ่มสถิติของ topic
  @Prop({ default: 0 })
  messageCount: number;

  @Prop()
  lastMessageAt?: Date;

  // Timestamps added by mongoose when timestamps: true
  createdAt?: Date;
  updatedAt?: Date;
}

export const TopicSchema = SchemaFactory.createForClass(Topic);