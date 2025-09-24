import { Injectable, Logger } from '@nestjs/common';
import { BotService } from '../modules/bot/bot.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private botService: BotService) {}

  async processUpdate(body: any) {
    try {
      await this.botService.processWebhookUpdate(body);
    } catch (error) {
      this.logger.error('Error processing webhook update:', error);
      throw error;
    }
  }
}