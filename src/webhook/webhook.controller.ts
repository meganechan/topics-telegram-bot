import { Body, Controller, Get, Post } from "@nestjs/common";
import { WebhookService } from "./webhook.service";

@Controller("webhook")
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Get("telegram")
  healthCheck() {
    return { status: "ok", message: "Telegram webhook is ready" };
  }

  @Post("telegram")
  async handleTelegramWebhook(@Body() body: any) {
    await this.webhookService.processUpdate(body);
    return { status: "ok" };
  }
}
