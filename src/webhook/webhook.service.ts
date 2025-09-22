import { Injectable } from '@nestjs/common';
import { BotService } from '../modules/bot/bot.service';

@Injectable()
export class WebhookService {
  constructor(private botService: BotService) {}

  async processUpdate(body: any) {
    try {
      await this.botService.processWebhookUpdate(body);
    } catch (error) {
      console.error('Error processing webhook update:', error);
      throw error;
    }
  }
}