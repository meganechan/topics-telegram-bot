import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  Hook,
  HookDocument,
  HookEvent,
  HookStatus,
} from "./schemas/hook.schema";
import {
  HookLog,
  HookLogDocument,
  HookLogStatus,
} from "./schemas/hook-log.schema";
import axios from "axios";
import * as crypto from "crypto";

export interface HookPayload {
  event: HookEvent;
  timestamp: string;
  data: Record<string, any>;
}

@Injectable()
export class HooksService {
  private readonly logger = new Logger(HooksService.name);

  constructor(
    @InjectModel(Hook.name) private hookModel: Model<HookDocument>,
    @InjectModel(HookLog.name) private hookLogModel: Model<HookLogDocument>,
  ) {
    // Start retry processor
    this.startRetryProcessor();
  }

  // ==================== Hook Management ====================

  async createHook(hookData: Partial<Hook>): Promise<Hook> {
    const hook = new this.hookModel(hookData);
    return hook.save();
  }

  async findAll(): Promise<Hook[]> {
    return this.hookModel.find().exec();
  }

  async findById(id: string): Promise<Hook | null> {
    return this.hookModel.findById(id).exec();
  }

  async findActiveByEvent(event: HookEvent): Promise<Hook[]> {
    return this.hookModel
      .find({
        status: HookStatus.ACTIVE,
        events: event,
      })
      .exec();
  }

  async updateHook(
    id: string,
    updateData: Partial<Hook>,
  ): Promise<Hook | null> {
    return this.hookModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .exec();
  }

  async deleteHook(id: string): Promise<boolean> {
    const result = await this.hookModel.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  async activateHook(id: string): Promise<Hook | null> {
    return this.updateHook(id, { status: HookStatus.ACTIVE });
  }

  async deactivateHook(id: string): Promise<Hook | null> {
    return this.updateHook(id, { status: HookStatus.INACTIVE });
  }

  // ==================== Event Triggering ====================

  async trigger(
    event: HookEvent,
    data: Record<string, any>,
    options?: {
      groupId?: string;
      ticketStatus?: string;
    },
  ): Promise<void> {
    try {
      let hooks = await this.findActiveByEvent(event);

      // Apply filters
      if (options?.groupId) {
        hooks = hooks.filter(
          (hook) =>
            !hook.filterGroupIds?.length ||
            hook.filterGroupIds.includes(options.groupId),
        );
      }

      if (options?.ticketStatus) {
        hooks = hooks.filter(
          (hook) =>
            !hook.filterTicketStatuses?.length ||
            hook.filterTicketStatuses.includes(options.ticketStatus),
        );
      }

      if (hooks.length === 0) {
        this.logger.debug(`No active hooks for event: ${event}`);
        return;
      }

      this.logger.log(
        `[${new Date().toISOString()}] Triggering ${hooks.length} hooks for event: ${event}`,
      );

      // Trigger hooks in parallel (non-blocking)
      const promises = hooks.map((hook) => this.executeHook(hook, event, data));

      // Don't await - let them run in background
      Promise.allSettled(promises).then((results) => {
        const succeeded = results.filter(
          (r) => r.status === "fulfilled",
        ).length;
        const failed = results.filter((r) => r.status === "rejected").length;
        this.logger.log(
          `[${new Date().toISOString()}] Hook results for ${event}: ${succeeded} succeeded, ${failed} failed`,
        );
      });
    } catch (error) {
      this.logger.error(`Error triggering hooks for event ${event}:`, error);
    }
  }

  private async executeHook(
    hook: Hook,
    event: HookEvent,
    data: Record<string, any>,
  ): Promise<void> {
    const startTime = Date.now();
    const payload: HookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    // Create log entry
    const hookLog = new this.hookLogModel({
      hookId: (hook as any)._id,
      event,
      payload,
      status: HookLogStatus.PENDING,
      attempts: 1,
    });
    await hookLog.save();

    try {
      // Prepare headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Hook-Event": event,
        "X-Hook-Timestamp": payload.timestamp,
        ...hook.headers,
      };

      // Add signature if secret is configured
      if (hook.secret) {
        const signature = this.generateSignature(payload, hook.secret);
        headers["X-Hook-Signature"] = signature;
      }

      // Make request
      const response = await axios.post(hook.url, payload, {
        headers,
        timeout: hook.timeout,
        validateStatus: () => true, // Accept all status codes
      });

      const duration = Date.now() - startTime;

      // Update log
      hookLog.status =
        response.status >= 200 && response.status < 300
          ? HookLogStatus.SUCCESS
          : HookLogStatus.FAILED;
      hookLog.responseStatus = response.status;
      hookLog.responseBody =
        typeof response.data === "string"
          ? response.data.substring(0, 1000)
          : JSON.stringify(response.data).substring(0, 1000);
      hookLog.duration = duration;
      hookLog.completedAt = new Date();

      if (hookLog.status === HookLogStatus.SUCCESS) {
        // Update hook success stats
        await this.hookModel.updateOne(
          { _id: (hook as any)._id },
          {
            $inc: { successCount: 1 },
            lastTriggeredAt: new Date(),
            lastSuccessAt: new Date(),
          },
        );
        this.logger.log(
          `[${new Date().toISOString()}] Hook ${hook.name} succeeded for ${event} (${duration}ms)`,
        );
      } else {
        // Handle failure
        await this.handleHookFailure(hook, hookLog, `HTTP ${response.status}`);
      }

      await hookLog.save();
    } catch (error) {
      const duration = Date.now() - startTime;
      hookLog.duration = duration;
      hookLog.errorMessage = error.message;

      await this.handleHookFailure(hook, hookLog, error.message);
      await hookLog.save();
    }
  }

  private async handleHookFailure(
    hook: Hook,
    hookLog: HookLogDocument,
    errorMessage: string,
  ): Promise<void> {
    this.logger.warn(
      `[${new Date().toISOString()}] Hook ${hook.name} failed: ${errorMessage}`,
    );

    // Update hook failure stats
    await this.hookModel.updateOne(
      { _id: (hook as any)._id },
      {
        $inc: { failureCount: 1 },
        lastTriggeredAt: new Date(),
        lastFailureAt: new Date(),
        lastError: errorMessage,
      },
    );

    // Schedule retry if under max retries
    if (hookLog.attempts < hook.maxRetries) {
      const backoffMs = Math.pow(2, hookLog.attempts) * 1000; // Exponential backoff
      hookLog.status = HookLogStatus.RETRYING;
      hookLog.nextRetryAt = new Date(Date.now() + backoffMs);
      this.logger.log(
        `[${new Date().toISOString()}] Scheduling retry for hook ${hook.name} in ${backoffMs}ms`,
      );
    } else {
      hookLog.status = HookLogStatus.FAILED;
      hookLog.completedAt = new Date();

      // Optionally deactivate hook after too many failures
      const recentFailures = await this.hookLogModel.countDocuments({
        hookId: (hook as any)._id,
        status: HookLogStatus.FAILED,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      });

      if (recentFailures >= 10) {
        this.logger.warn(
          `[${new Date().toISOString()}] Deactivating hook ${hook.name} due to repeated failures`,
        );
        await this.deactivateHook((hook as any)._id.toString());
      }
    }
  }

  private generateSignature(payload: HookPayload, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(JSON.stringify(payload));
    return `sha256=${hmac.digest("hex")}`;
  }

  // ==================== Retry Processor ====================

  private startRetryProcessor(): void {
    // Process retries every 30 seconds
    setInterval(async () => {
      try {
        await this.processRetries();
      } catch (error) {
        this.logger.error("Error processing hook retries:", error);
      }
    }, 30000);

    this.logger.log("Hook retry processor started");
  }

  private async processRetries(): Promise<void> {
    const pendingRetries = await this.hookLogModel
      .find({
        status: HookLogStatus.RETRYING,
        nextRetryAt: { $lte: new Date() },
      })
      .limit(10)
      .exec();

    if (pendingRetries.length === 0) return;

    this.logger.log(
      `[${new Date().toISOString()}] Processing ${pendingRetries.length} hook retries`,
    );

    for (const log of pendingRetries) {
      const hook = await this.hookModel.findById(log.hookId);
      if (!hook || hook.status !== HookStatus.ACTIVE) {
        log.status = HookLogStatus.FAILED;
        log.completedAt = new Date();
        log.errorMessage = "Hook deactivated or deleted";
        await log.save();
        continue;
      }

      log.attempts += 1;
      await log.save();

      // Re-execute hook
      await this.retryHookExecution(hook, log);
    }
  }

  private async retryHookExecution(
    hook: Hook,
    hookLog: HookLogDocument,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Hook-Event": hookLog.event,
        "X-Hook-Timestamp": hookLog.payload.timestamp,
        "X-Hook-Retry": hookLog.attempts.toString(),
        ...hook.headers,
      };

      if (hook.secret) {
        const signature = this.generateSignature(
          hookLog.payload as HookPayload,
          hook.secret,
        );
        headers["X-Hook-Signature"] = signature;
      }

      const response = await axios.post(hook.url, hookLog.payload, {
        headers,
        timeout: hook.timeout,
        validateStatus: () => true,
      });

      const duration = Date.now() - startTime;

      hookLog.responseStatus = response.status;
      hookLog.responseBody =
        typeof response.data === "string"
          ? response.data.substring(0, 1000)
          : JSON.stringify(response.data).substring(0, 1000);
      hookLog.duration = duration;

      if (response.status >= 200 && response.status < 300) {
        hookLog.status = HookLogStatus.SUCCESS;
        hookLog.completedAt = new Date();

        await this.hookModel.updateOne(
          { _id: (hook as any)._id },
          {
            $inc: { successCount: 1 },
            lastSuccessAt: new Date(),
          },
        );

        this.logger.log(
          `[${new Date().toISOString()}] Hook retry ${hook.name} succeeded (attempt ${hookLog.attempts})`,
        );
      } else {
        await this.handleHookFailure(hook, hookLog, `HTTP ${response.status}`);
      }

      await hookLog.save();
    } catch (error) {
      hookLog.duration = Date.now() - startTime;
      hookLog.errorMessage = error.message;
      await this.handleHookFailure(hook, hookLog, error.message);
      await hookLog.save();
    }
  }

  // ==================== Logs & Stats ====================

  async getHookLogs(hookId: string, limit: number = 50): Promise<HookLog[]> {
    return this.hookLogModel
      .find({ hookId: new Types.ObjectId(hookId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async getRecentLogs(limit: number = 100): Promise<HookLog[]> {
    return this.hookLogModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("hookId", "name url")
      .exec();
  }

  async getHookStats(hookId: string): Promise<{
    totalTriggers: number;
    successRate: number;
    avgResponseTime: number;
    lastTriggered: Date | null;
    eventBreakdown: Record<string, number>;
  }> {
    const hook = await this.hookModel.findById(hookId);
    if (!hook) return null;

    const logs = await this.hookLogModel
      .find({ hookId: new Types.ObjectId(hookId) })
      .exec();

    const totalTriggers = hook.successCount + hook.failureCount;
    const successRate =
      totalTriggers > 0 ? (hook.successCount / totalTriggers) * 100 : 0;

    const durations = logs.filter((l) => l.duration).map((l) => l.duration);
    const avgResponseTime =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    const eventBreakdown = logs.reduce(
      (acc, log) => {
        acc[log.event] = (acc[log.event] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalTriggers,
      successRate: Math.round(successRate * 100) / 100,
      avgResponseTime: Math.round(avgResponseTime),
      lastTriggered: hook.lastTriggeredAt,
      eventBreakdown,
    };
  }

  async testHook(hookId: string): Promise<{
    success: boolean;
    statusCode?: number;
    responseTime?: number;
    error?: string;
  }> {
    const hook = await this.hookModel.findById(hookId);
    if (!hook) {
      return { success: false, error: "Hook not found" };
    }

    const testPayload: HookPayload = {
      event: HookEvent.TICKET_CREATED,
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: "This is a test webhook",
        hookId: hookId,
      },
    };

    const startTime = Date.now();

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Hook-Event": "test",
        "X-Hook-Test": "true",
        ...hook.headers,
      };

      if (hook.secret) {
        headers["X-Hook-Signature"] = this.generateSignature(
          testPayload,
          hook.secret,
        );
      }

      const response = await axios.post(hook.url, testPayload, {
        headers,
        timeout: hook.timeout,
        validateStatus: () => true,
      });

      return {
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }
}
