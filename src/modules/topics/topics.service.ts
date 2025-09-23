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
    // สำหรับ cross-group support: ต้องหา topic แต่ละตัวใน group ที่ถูกต้อง
    console.log(`[${new Date().toISOString()}] 🔗 LINKING TOPICS: ${topicId1} ↔ ${topicId2}`);

    // ค้นหา topic1 ใน group ที่ระบุ
    let topic1 = await this.findByTelegramTopicId(topicId1, groupId);
    if (!topic1) {
      // ถ้าไม่เจอ ให้ค้นหา globally
      const allTopic1 = await this.findByTelegramTopicIdGlobal(topicId1);
      topic1 = allTopic1[0];
    }

    // ค้นหา topic2 ใน group ที่ระบุ
    let topic2 = await this.findByTelegramTopicId(topicId2, groupId);
    if (!topic2) {
      // ถ้าไม่เจอ ให้ค้นหา globally
      const allTopic2 = await this.findByTelegramTopicIdGlobal(topicId2);
      topic2 = allTopic2[0];
    }

    if (!topic1 || !topic2) {
      console.error(`[${new Date().toISOString()}] ❌ Cannot link topics: topic1=${!!topic1}, topic2=${!!topic2}`);
      return;
    }

    console.log(`  - Topic1: ${topicId1} in group ${topic1.groupId}`);
    console.log(`  - Topic2: ${topicId2} in group ${topic2.groupId}`);

    // อัพเดต topic1 ให้ link ไป topic2 (เก็บทั้ง topicId และ groupId)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId: topic1.groupId },
        { $addToSet: { linkedTopics: { topicId: topicId2, groupId: topic2.groupId } } },
      )
      .exec();

    // อัพเดต topic2 ให้ link ไป topic1 (เก็บทั้ง topicId และ groupId)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId: topic2.groupId },
        { $addToSet: { linkedTopics: { topicId: topicId1, groupId: topic1.groupId } } },
      )
      .exec();

    console.log(`  ✅ Topics linked successfully`);
  }

  async unlinkTopics(
    topicId1: number,
    topicId2: number,
    groupId: string,
  ): Promise<void> {
    // สำหรับ cross-group support: ต้องหา topic แต่ละตัวใน group ที่ถูกต้อง
    console.log(`[${new Date().toISOString()}] 🔗 UNLINKING TOPICS: ${topicId1} ↮ ${topicId2}`);

    // ค้นหา topic1 ใน group ที่ระบุ
    let topic1 = await this.findByTelegramTopicId(topicId1, groupId);
    if (!topic1) {
      // ถ้าไม่เจอ ให้ค้นหา globally
      const allTopic1 = await this.findByTelegramTopicIdGlobal(topicId1);
      topic1 = allTopic1[0];
    }

    // ค้นหา topic2 ใน group ที่ระบุ
    let topic2 = await this.findByTelegramTopicId(topicId2, groupId);
    if (!topic2) {
      // ถ้าไม่เจอ ให้ค้นหา globally
      const allTopic2 = await this.findByTelegramTopicIdGlobal(topicId2);
      topic2 = allTopic2[0];
    }

    if (!topic1 || !topic2) {
      console.error(`[${new Date().toISOString()}] ❌ Cannot unlink topics: topic1=${!!topic1}, topic2=${!!topic2}`);
      return;
    }

    console.log(`  - Topic1: ${topicId1} in group ${topic1.groupId}`);
    console.log(`  - Topic2: ${topicId2} in group ${topic2.groupId}`);

    // ลบ link จาก topic1 ไป topic2 (ใช้ object structure ใหม่)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId: topic1.groupId },
        { $pull: { linkedTopics: { topicId: topicId2, groupId: topic2.groupId } } },
      )
      .exec();

    // ลบ link จาก topic2 ไป topic1 (ใช้ object structure ใหม่)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId: topic2.groupId },
        { $pull: { linkedTopics: { topicId: topicId1, groupId: topic1.groupId } } },
      )
      .exec();

    console.log(`  ✅ Topics unlinked successfully`);
  }

  async getLinkedTopics(
    telegramTopicId: number,
    groupId: string,
  ): Promise<Array<{ topicId: number; groupId: string }>> {
    // ค้นหา topic ใน group ที่ระบุ
    const topic = await this.findByTelegramTopicId(telegramTopicId, groupId);

    if (!topic) {
      console.log(`  ❌ Topic ${telegramTopicId} not found in group ${groupId}`);
      return [];
    }

    if (!topic.ticketId) {
      console.log(`  ⚠️ Topic ${telegramTopicId} has no ticketId - no linked topics available`);
      return [];
    }

    console.log(`  🎫 Searching for topics with ticketId: ${topic.ticketId}`);

    // ค้นหา topics อื่นที่มี ticketId เดียวกัน
    const relatedTopics = await this.topicModel
      .find({
        ticketId: topic.ticketId,
        $or: [
          { telegramTopicId: { $ne: telegramTopicId } }, // topic อื่นที่ไม่ใช่ตัวเอง
          { groupId: { $ne: groupId } } // หรือ topic ในกลุ่มอื่น
        ]
      })
      .exec();

    const linkedTopics = relatedTopics.map(relatedTopic => ({
      topicId: relatedTopic.telegramTopicId,
      groupId: relatedTopic.groupId
    }));

    console.log(`  🔍 Found ${linkedTopics.length} topics with same ticketId:`,
      linkedTopics.map(lt => `${lt.topicId}@${lt.groupId}`).join(', '));

    return linkedTopics;
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

  async findByTelegramTopicIdGlobal(telegramTopicId: number): Promise<Topic[]> {
    return this.topicModel
      .find({ telegramTopicId })
      .exec();
  }

  async removeBrokenLink(
    sourceTopicId: number,
    brokenTopicId: number,
    brokenGroupId: string,
    sourceGroupId: string,
  ): Promise<void> {
    try {
      // Remove the broken link using the new object structure
      await this.topicModel
        .updateOne(
          { telegramTopicId: sourceTopicId, groupId: sourceGroupId },
          { $pull: { linkedTopics: { topicId: brokenTopicId, groupId: brokenGroupId } } }
        )
        .exec();

      console.log(`[${new Date().toISOString()}] 🧹 Removed broken link ${brokenTopicId}@${brokenGroupId} from topic ${sourceTopicId}@${sourceGroupId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error removing broken link:`, error);
    }
  }

  async deleteTopicAndRelations(telegramTopicId: number, groupId: string): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] 🗑️ Deleting topic ${telegramTopicId}@${groupId} and all its relations`);

      // First find the topic to get its linked topics
      const topic = await this.findByTelegramTopicId(telegramTopicId, groupId);

      if (topic && topic.linkedTopics && topic.linkedTopics.length > 0) {
        // Remove this topic from all linked topics
        for (const linkedTopic of topic.linkedTopics) {
          await this.removeBrokenLink(linkedTopic.topicId, telegramTopicId, groupId, linkedTopic.groupId);
        }
      }

      // Delete the topic itself
      await this.deleteTopic(telegramTopicId, groupId);

    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error deleting topic and relations:`, error);
    }
  }

  // 🔄 Topic Sync System
  async getAllTopics(): Promise<Topic[]> {
    return this.topicModel.find({}).exec();
  }

  async getTopicsByGroup(groupId: string): Promise<Topic[]> {
    return this.topicModel.find({ groupId }).exec();
  }

  async deleteTopic(telegramTopicId: number, groupId: string): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] 🗑️ Deleting topic ${telegramTopicId} from group ${groupId}`);

      // ลบ topic จาก database
      const result = await this.topicModel.deleteOne({ telegramTopicId, groupId }).exec();

      if (result.deletedCount > 0) {
        console.log(`[${new Date().toISOString()}] ✅ Successfully deleted topic ${telegramTopicId}`);

        // ลบ references ของ topic นี้จาก linkedTopics ของ topics อื่น
        await this.removeTopicReferences(telegramTopicId);
      } else {
        console.log(`[${new Date().toISOString()}] ⚠️ Topic ${telegramTopicId} not found in database`);
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error deleting topic ${telegramTopicId}:`, error);
    }
  }

  private async removeTopicReferences(deletedTopicId: number): Promise<void> {
    try {
      // ลบ reference ของ topic ที่ถูกลบจาก linkedTopics ของ topics อื่น ๆ
      await this.topicModel
        .updateMany(
          { linkedTopics: deletedTopicId },
          { $pull: { linkedTopics: deletedTopicId } }
        )
        .exec();

      console.log(`[${new Date().toISOString()}] 🧹 Removed all references to deleted topic ${deletedTopicId}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error removing topic references:`, error);
    }
  }

  async updateTopicActiveStatus(telegramTopicId: number, groupId: string, isActive: boolean): Promise<void> {
    try {
      await this.topicModel
        .updateOne(
          { telegramTopicId, groupId },
          { isActive }
        )
        .exec();

      console.log(`[${new Date().toISOString()}] 📝 Updated topic ${telegramTopicId} active status: ${isActive}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Error updating topic status:`, error);
    }
  }
}