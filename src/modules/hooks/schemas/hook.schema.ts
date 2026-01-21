import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type HookDocument = Hook & Document;

export enum HookEvent {
  TICKET_CREATED = "ticket.created",
  TICKET_UPDATED = "ticket.updated",
  TICKET_CLOSED = "ticket.closed",
  MESSAGE_SENT = "message.sent",
  USER_MENTIONED = "user.mentioned",
  TOPIC_CREATED = "topic.created",
  TOPIC_LINKED = "topic.linked",
  ERROR_OCCURRED = "error.occurred",
}

export enum HookStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  FAILED = "failed",
}

@Schema({ timestamps: true })
export class Hook {
  @Prop({ required: true })
  name: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  url: string;

  @Prop({ type: [String], enum: HookEvent, required: true })
  events: HookEvent[];

  @Prop({ enum: HookStatus, default: HookStatus.ACTIVE })
  status: HookStatus;

  @Prop()
  secret?: string; // For webhook signature verification

  @Prop({ type: Object, default: {} })
  headers: Record<string, string>;

  @Prop({ default: 3 })
  maxRetries: number;

  @Prop({ default: 30000 })
  timeout: number; // in milliseconds

  @Prop({ default: 0 })
  successCount: number;

  @Prop({ default: 0 })
  failureCount: number;

  @Prop()
  lastTriggeredAt?: Date;

  @Prop()
  lastSuccessAt?: Date;

  @Prop()
  lastFailureAt?: Date;

  @Prop()
  lastError?: string;

  @Prop()
  createdBy?: string;

  @Prop({ type: [String], default: [] })
  filterGroupIds?: string[]; // Only trigger for specific groups

  @Prop({ type: [String], default: [] })
  filterTicketStatuses?: string[]; // Only trigger for specific ticket statuses
}

export const HookSchema = SchemaFactory.createForClass(Hook);

HookSchema.index({ status: 1 });
HookSchema.index({ events: 1 });
HookSchema.index({ filterGroupIds: 1 });
