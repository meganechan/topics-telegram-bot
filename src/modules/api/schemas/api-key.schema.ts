import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export type ApiKeyDocument = ApiKey & Document;

export enum ApiKeyScope {
  READ = "read",
  WRITE = "write",
  ADMIN = "admin",
}

@Schema({ timestamps: true })
export class ApiKey {
  @Prop({ required: true, unique: true })
  key: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ type: [String], enum: ApiKeyScope, default: [ApiKeyScope.READ] })
  scopes: ApiKeyScope[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: 0 })
  usageCount: number;

  @Prop({ type: [String], default: [] })
  allowedIps: string[];

  @Prop()
  createdBy?: string;

  static generateKey(): string {
    return `tk_${uuidv4().replace(/-/g, "")}`;
  }
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);

ApiKeySchema.index({ key: 1 }, { unique: true });
ApiKeySchema.index({ isActive: 1 });
