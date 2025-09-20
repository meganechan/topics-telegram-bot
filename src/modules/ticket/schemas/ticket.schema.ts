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
  groupId: string; // Group Telegram ID

  @Prop()
  topicId?: number; // Telegram Topic ID

  @Prop()
  closedAt?: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);