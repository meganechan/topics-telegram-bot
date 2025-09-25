import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Topic, TopicSchema } from './schemas/topic.schema';
import { TopicsService } from './topics.service';
import { TicketModule } from '../ticket/ticket.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Topic.name, schema: TopicSchema }]),
    forwardRef(() => TicketModule),
  ],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}