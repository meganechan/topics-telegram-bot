import { Module, forwardRef } from "@nestjs/common";
import { BotService } from "./bot.service";
import { UsersModule } from "../users/users.module";
import { GroupsModule } from "../groups/groups.module";
import { TicketModule } from "../ticket/ticket.module";
import { TopicsModule } from "../topics/topics.module";
import { AttachmentsModule } from "../attachments/attachments.module";
import { MessagesModule } from "../messages/messages.module";
import { HooksModule } from "../hooks/hooks.module";

@Module({
  imports: [
    UsersModule,
    GroupsModule,
    TicketModule,
    TopicsModule,
    AttachmentsModule,
    MessagesModule,
    forwardRef(() => HooksModule),
  ],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
