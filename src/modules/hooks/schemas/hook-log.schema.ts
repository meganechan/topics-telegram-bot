import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { HookEvent } from "./hook.schema";

export type HookLogDocument = HookLog & Document;

export enum HookLogStatus {
  PENDING = "pending",
  SUCCESS = "success",
  FAILED = "failed",
  RETRYING = "retrying",
}

@Schema({ timestamps: true })
export class HookLog {
  @Prop({ type: Types.ObjectId, ref: "Hook", required: true })
  hookId: Types.ObjectId;

  @Prop({ required: true, enum: HookEvent })
  event: HookEvent;

  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({ enum: HookLogStatus, default: HookLogStatus.PENDING })
  status: HookLogStatus;

  @Prop({ default: 0 })
  attempts: number;

  @Prop()
  responseStatus?: number;

  @Prop()
  responseBody?: string;

  @Prop()
  errorMessage?: string;

  @Prop()
  duration?: number; // in milliseconds

  @Prop()
  nextRetryAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const HookLogSchema = SchemaFactory.createForClass(HookLog);

HookLogSchema.index({ hookId: 1 });
HookLogSchema.index({ status: 1 });
HookLogSchema.index({ event: 1 });
HookLogSchema.index({ createdAt: -1 });
HookLogSchema.index({ nextRetryAt: 1, status: 1 });

// Auto-expire logs after 30 days
HookLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
