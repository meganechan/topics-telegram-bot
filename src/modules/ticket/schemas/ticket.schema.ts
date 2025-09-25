import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TicketDocument = Ticket & Document;

export enum TicketStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  PENDING = 'pending',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ required: true, unique: true })
  ticketId: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop({ enum: TicketStatus, default: TicketStatus.OPEN })
  status: TicketStatus;

  @Prop({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  priority: TicketPriority;

  @Prop({ required: true })
  createdBy: string; // Telegram User ID

  @Prop()
  assignedTo?: string; // Telegram User ID

  @Prop({ required: true })
  groupId: string; // Primary Group Telegram ID (where ticket was created)

  // เปลี่ยนจาก topicId เดียว เป็น array ของ topics
  @Prop({
    type: [{
      topicId: { type: Number, required: true },
      groupId: { type: String, required: true },
      name: { type: String, required: true },
      isPrimary: { type: Boolean, default: false } // topic หลักที่สร้างตอนแรก
    }],
    default: []
  })
  topics: Array<{
    topicId: number;
    groupId: string;
    name: string;
    isPrimary: boolean;
  }>;

  // เพิ่ม participants ที่ระดับ ticket
  @Prop({ type: [String], default: [] })
  participants: string[]; // Array of User Telegram IDs across all topics

  // เพิ่มข้อมูลสถิติ
  @Prop({ default: 0 })
  totalMessages: number;

  @Prop({ default: 0 })
  totalTopics: number;

  @Prop()
  lastActivityAt?: Date; // อัปเดตเมื่อมีข้อความใหม่ใน topic ใดๆ

  @Prop()
  closedAt?: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);