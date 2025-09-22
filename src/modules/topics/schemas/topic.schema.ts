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

  @Prop({
    type: [{
      topicId: { type: Number, required: true },
      groupId: { type: String, required: true }
    }],
    default: []
  })
  linkedTopics: Array<{ topicId: number; groupId: string }>; // Array of linked topic info

  @Prop({ type: [String], default: [] })
  participants: string[]; // Array of User Telegram IDs

  @Prop()
  createdBy?: string; // User Telegram ID who created this topic

  @Prop({ default: true })
  isActive: boolean;
}

export const TopicSchema = SchemaFactory.createForClass(Topic);