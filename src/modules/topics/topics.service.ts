import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Topic, TopicDocument } from './schemas/topic.schema';

@Injectable()
export class TopicsService {
  constructor(
    @InjectModel(Topic.name) private topicModel: Model<TopicDocument>,
  ) {}

  async createTopic(topicData: Partial<Topic>): Promise<Topic> {
    const topic = new this.topicModel(topicData);
    return topic.save();
  }

  async findByTelegramTopicId(
    telegramTopicId: number,
    groupId: string,
  ): Promise<Topic | null> {
    return this.topicModel
      .findOne({ telegramTopicId, groupId })
      .exec();
  }

  async findByTicketId(ticketId: string): Promise<Topic | null> {
    return this.topicModel.findOne({ ticketId }).exec();
  }

  async linkTopics(
    topicId1: number,
    topicId2: number,
    groupId: string,
  ): Promise<void> {
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId },
        { $addToSet: { linkedTopics: topicId2 } },
      )
      .exec();

    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId },
        { $addToSet: { linkedTopics: topicId1 } },
      )
      .exec();
  }

  async unlinkTopics(
    topicId1: number,
    topicId2: number,
    groupId: string,
  ): Promise<void> {
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId },
        { $pull: { linkedTopics: topicId2 } },
      )
      .exec();

    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId },
        { $pull: { linkedTopics: topicId1 } },
      )
      .exec();
  }

  async getLinkedTopics(
    telegramTopicId: number,
    groupId: string,
  ): Promise<number[]> {
    const topic = await this.findByTelegramTopicId(telegramTopicId, groupId);
    return topic?.linkedTopics || [];
  }

  async addParticipant(
    telegramTopicId: number,
    groupId: string,
    userId: string,
  ): Promise<Topic> {
    return this.topicModel
      .findOneAndUpdate(
        { telegramTopicId, groupId },
        { $addToSet: { participants: userId } },
        { new: true },
      )
      .exec();
  }

  async deactivateTopic(
    telegramTopicId: number,
    groupId: string,
  ): Promise<Topic> {
    return this.topicModel
      .findOneAndUpdate(
        { telegramTopicId, groupId },
        { isActive: false },
        { new: true },
      )
      .exec();
  }
}