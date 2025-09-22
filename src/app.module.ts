import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';

import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import telegramConfig from './config/telegram.config';

import { BotModule } from './modules/bot/bot.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { UsersModule } from './modules/users/users.module';
import { GroupsModule } from './modules/groups/groups.module';
import { TopicsModule } from './modules/topics/topics.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { MessagesModule } from './modules/messages/messages.module';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, telegramConfig],
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/topics-telegram-bot',
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    BotModule,
    TicketModule,
    UsersModule,
    GroupsModule,
    TopicsModule,
    AttachmentsModule,
    MessagesModule,
    WebhookModule,
  ],
})
export class AppModule {}