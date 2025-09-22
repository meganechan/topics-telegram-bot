import { Body, Controller, Post } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('telegram')
  async handleTelegramWebhook(@Body() body: any) {
    await this.webhookService.processUpdate(body);
    return { status: 'ok' };
  }
}