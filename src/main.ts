import { NestFactory } from "@nestjs/core";
import { ValidationPipe, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // Log MongoDB URI (masked) for debugging
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/topics-telegram-bot";
  const maskedUri = mongoUri.replace(/:([^@]+)@/, ":***@");
  logger.log(`MongoDB URI: ${maskedUri}`);

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Setup Swagger documentation
  const config = new DocumentBuilder()
    .setTitle("Telegram Ticket Support API")
    .setDescription(
      `
## Overview
REST API for Telegram Ticket Support System using Topics.

## Authentication
All endpoints require API key authentication. You can provide the API key in one of three ways:
- **Authorization header**: \`Bearer <api_key>\`
- **X-API-Key header**: \`<api_key>\`
- **Query parameter**: \`?api_key=<api_key>\`

## Scopes
- **read**: Can read tickets, messages, users, groups
- **write**: Can create/update tickets, send messages, mention users
- **admin**: Can manage API keys and hooks

## Webhooks
Configure webhooks to receive real-time notifications for events:
- \`ticket.created\` - When a new ticket is created
- \`ticket.updated\` - When a ticket is updated
- \`ticket.closed\` - When a ticket is closed
- \`message.sent\` - When a message is sent
- \`user.mentioned\` - When a user is mentioned
- \`topic.created\` - When a topic is created
- \`topic.linked\` - When topics are linked
- \`error.occurred\` - When an error occurs
    `,
    )
    .setVersion("1.0")
    .addBearerAuth()
    .addApiKey({ type: "apiKey", name: "X-API-Key", in: "header" }, "api-key")
    .addTag("Tickets", "Ticket management endpoints")
    .addTag("Messages", "Message endpoints")
    .addTag("Hooks", "Webhook management endpoints")
    .addTag("API Keys", "API key management endpoints")
    .addTag("Groups", "Group management endpoints")
    .addTag("Users", "User management endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = configService.get<number>("app.port") || 3000;
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
