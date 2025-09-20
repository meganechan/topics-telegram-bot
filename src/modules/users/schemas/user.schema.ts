import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  telegramId: string;

  @Prop({ required: true })
  username: string;

  @Prop()
  externalUsername?: string;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop({ default: false })
  isBot: boolean;

  @Prop()
  languageCode?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);