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

  @Prop()
  ticketId?: string; // Ticket ID

  @Prop({ type: [Number], default: [] })
  linkedTopics: number[]; // Array of linked topic IDs

  @Prop({ type: [String], default: [] })
  participants: string[]; // Array of User Telegram IDs

  @Prop({ default: true })
  isActive: boolean;
}

export const TopicSchema = SchemaFactory.createForClass(Topic);