import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ApiController } from "./api.controller";
import { ApiKeyController } from "./api-key.controller";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { ApiKey, ApiKeySchema } from "./schemas/api-key.schema";
import { TicketModule } from "../ticket/ticket.module";
import { MessagesModule } from "../messages/messages.module";
import { TopicsModule } from "../topics/topics.module";
import { UsersModule } from "../users/users.module";
import { GroupsModule } from "../groups/groups.module";
import { BotModule } from "../bot/bot.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ApiKey.name, schema: ApiKeySchema }]),
    TicketModule,
    MessagesModule,
    TopicsModule,
    UsersModule,
    GroupsModule,
    forwardRef(() => BotModule),
  ],
  controllers: [ApiController, ApiKeyController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiModule {}
