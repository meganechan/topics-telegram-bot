import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true, unique: true })
  telegramGroupId: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  type: string; // 'group' | 'supergroup'

  @Prop({ default: false })
  botIsAdmin: boolean;

  @Prop({ default: false })
  supportTopicsEnabled: boolean;
}

export const GroupSchema = SchemaFactory.createForClass(Group);