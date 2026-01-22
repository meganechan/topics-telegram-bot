import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Topic, TopicDocument } from "./schemas/topic.schema";
import { TicketService } from "../ticket/ticket.service";

@Injectable()
export class TopicsService {
  private readonly logger = new Logger(TopicsService.name);

  constructor(
    @InjectModel(Topic.name) private topicModel: Model<TopicDocument>,
    private ticketService: TicketService,
  ) {}

  async createTopic(topicData: Partial<Topic>): Promise<Topic> {
    // ตรวจสอบว่า ticketId ต้องมี
    if (!topicData.ticketId) {
      throw new Error("ticketId is required for creating topic");
    }

    const topic = new this.topicModel(topicData);
    const savedTopic = await topic.save();

    // อัปเดต ticket ให้เพิ่ม topic นี้
    await this.ticketService.addTopicToTicket(topicData.ticketId, {
      topicId: savedTopic.telegramTopicId,
      groupId: savedTopic.groupId,
      name: savedTopic.name,
      isPrimary: topicData.isPrimary || false,
    });

    return savedTopic;
  }

  async findByTelegramTopicId(
    telegramTopicId: number,
    groupId: string,
  ): Promise<Topic | null> {
    return this.topicModel.findOne({ telegramTopicId, groupId }).exec();
  }

  async findByTicketId(ticketId: string): Promise<Topic | null> {
    return this.topicModel.findOne({ ticketId }).exec();
  }

  async findAllByTicketId(ticketId: string): Promise<Topic[]> {
    return this.topicModel.find({ ticketId }).exec();
  }

  async linkTopics(
    topicId1: number,
    topicId2: number,
    groupId: string,
  ): Promise<void> {
    // สำหรับ cross-group support: ต้องหา topic แต่ละตัวใน group ที่ถูกต้อง
    this.logger.log(
      `[${new Date().toISOString()}] 🔗 LINKING TOPICS: ${topicId1} ↔ ${topicId2}`,
    );

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
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Cannot link topics: topic1=${!!topic1}, topic2=${!!topic2}`,
      );
      return;
    }

    this.logger.log(`  - Topic1: ${topicId1} in group ${topic1.groupId}`);
    this.logger.log(`  - Topic2: ${topicId2} in group ${topic2.groupId}`);

    // อัพเดต topic1 ให้ link ไป topic2 (เก็บทั้ง topicId และ groupId)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId: topic1.groupId },
        {
          $addToSet: {
            linkedTopics: { topicId: topicId2, groupId: topic2.groupId },
          },
        },
      )
      .exec();

    // อัพเดต topic2 ให้ link ไป topic1 (เก็บทั้ง topicId และ groupId)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId: topic2.groupId },
        {
          $addToSet: {
            linkedTopics: { topicId: topicId1, groupId: topic1.groupId },
          },
        },
      )
      .exec();

    this.logger.log(`  ✅ Topics linked successfully`);
  }

  async unlinkTopics(
    topicId1: number,
    topicId2: number,
    groupId: string,
  ): Promise<void> {
    // สำหรับ cross-group support: ต้องหา topic แต่ละตัวใน group ที่ถูกต้อง
    this.logger.log(
      `[${new Date().toISOString()}] 🔗 UNLINKING TOPICS: ${topicId1} ↮ ${topicId2}`,
    );

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
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Cannot unlink topics: topic1=${!!topic1}, topic2=${!!topic2}`,
      );
      return;
    }

    this.logger.log(`  - Topic1: ${topicId1} in group ${topic1.groupId}`);
    this.logger.log(`  - Topic2: ${topicId2} in group ${topic2.groupId}`);

    // ลบ link จาก topic1 ไป topic2 (ใช้ object structure ใหม่)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId1, groupId: topic1.groupId },
        {
          $pull: {
            linkedTopics: { topicId: topicId2, groupId: topic2.groupId },
          },
        },
      )
      .exec();

    // ลบ link จาก topic2 ไป topic1 (ใช้ object structure ใหม่)
    await this.topicModel
      .updateOne(
        { telegramTopicId: topicId2, groupId: topic2.groupId },
        {
          $pull: {
            linkedTopics: { topicId: topicId1, groupId: topic1.groupId },
          },
        },
      )
      .exec();

    this.logger.log(`  ✅ Topics unlinked successfully`);
  }

  // เปลี่ยน getLinkedTopics ให้ใช้ ticket เป็นตัวกลาง
  async getLinkedTopics(
    telegramTopicId: number,
    groupId: string,
  ): Promise<Array<{ topicId: number; groupId: string }>> {
    // หา topic ปัจจุบัน
    const currentTopic = await this.findByTelegramTopicId(
      telegramTopicId,
      groupId,
    );

    if (!currentTopic || !currentTopic.ticketId) {
      this.logger.log(
        `  ❌ Topic ${telegramTopicId} not found or has no ticketId`,
      );
      return [];
    }

    this.logger.log(
      `  🎫 Finding linked topics via ticketId: ${currentTopic.ticketId}`,
    );

    // หา topics อื่นใน ticket เดียวกัน
    const relatedTopics = await this.topicModel
      .find({
        ticketId: currentTopic.ticketId,
        $or: [
          { telegramTopicId: { $ne: telegramTopicId } },
          { groupId: { $ne: groupId } },
        ],
        isActive: true,
      })
      .exec();

    const linkedTopics = relatedTopics.map((topic) => ({
      topicId: topic.telegramTopicId,
      groupId: topic.groupId,
    }));

    this.logger.log(
      `  🔍 Found ${linkedTopics.length} linked topics:`,
      linkedTopics.map((lt) => `${lt.topicId}@${lt.groupId}`).join(", "),
    );

    return linkedTopics;
  }

  // อัปเดต addParticipant ให้อัปเดตทั้ง topic และ ticket
  async addParticipant(
    telegramTopicId: number,
    groupId: string,
    userId: string,
  ): Promise<Topic> {
    const topic = await this.topicModel
      .findOneAndUpdate(
        { telegramTopicId, groupId },
        {}, // ไม่เก็บ participants ใน topic แล้ว
        { new: true },
      )
      .exec();

    // เพิ่ม participant ใน ticket
    if (topic && topic.ticketId) {
      await this.ticketService.addParticipant(topic.ticketId, userId);
    }

    return topic;
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
    return this.topicModel.find({ telegramTopicId }).exec();
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
          {
            $pull: {
              linkedTopics: { topicId: brokenTopicId, groupId: brokenGroupId },
            },
          },
        )
        .exec();

      this.logger.log(
        `[${new Date().toISOString()}] 🧹 Removed broken link ${brokenTopicId}@${brokenGroupId} from topic ${sourceTopicId}@${sourceGroupId}`,
      );
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error removing broken link:`,
        error,
      );
    }
  }

  async deleteTopicAndRelations(
    telegramTopicId: number,
    groupId: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `[${new Date().toISOString()}] 🗑️ Deleting topic ${telegramTopicId}@${groupId} and all its relations`,
      );

      // First find the topic to get its linked topics (ใช้ ticket เป็นตัวกลาง)
      const topic = await this.findByTelegramTopicId(telegramTopicId, groupId);

      if (topic && topic.ticketId) {
        // หา topics อื่นใน ticket เดียวกันและ deactivate พวกมัน
        const relatedTopics = await this.topicModel
          .find({
            ticketId: topic.ticketId,
            telegramTopicId: { $ne: telegramTopicId },
            isActive: true,
          })
          .exec();

        // ลบ topic นี้ออกจาก ticket
        if (this.ticketService) {
          await this.ticketService.removeTopicFromTicket(
            topic.ticketId,
            telegramTopicId,
            groupId,
          );
        }
      }

      // Delete the topic itself
      await this.deleteTopic(telegramTopicId, groupId);
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error deleting topic and relations:`,
        error,
      );
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
      this.logger.log(
        `[${new Date().toISOString()}] 🗑️ Deleting topic ${telegramTopicId} from group ${groupId}`,
      );

      // ลบ topic จาก database
      const result = await this.topicModel
        .deleteOne({ telegramTopicId, groupId })
        .exec();

      if (result.deletedCount > 0) {
        this.logger.log(
          `[${new Date().toISOString()}] ✅ Successfully deleted topic ${telegramTopicId}`,
        );

        // ลบ references ของ topic นี้จาก linkedTopics ของ topics อื่น
        await this.removeTopicReferences(telegramTopicId);
      } else {
        this.logger.log(
          `[${new Date().toISOString()}] ⚠️ Topic ${telegramTopicId} not found in database`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error deleting topic ${telegramTopicId}:`,
        error,
      );
    }
  }

  private async removeTopicReferences(deletedTopicId: number): Promise<void> {
    try {
      // ลบ reference ของ topic ที่ถูกลบจาก linkedTopics ของ topics อื่น ๆ
      await this.topicModel
        .updateMany(
          { linkedTopics: deletedTopicId },
          { $pull: { linkedTopics: deletedTopicId } },
        )
        .exec();

      this.logger.log(
        `[${new Date().toISOString()}] 🧹 Removed all references to deleted topic ${deletedTopicId}`,
      );
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error removing topic references:`,
        error,
      );
    }
  }

  async updateTopicActiveStatus(
    telegramTopicId: number,
    groupId: string,
    isActive: boolean,
  ): Promise<void> {
    try {
      await this.topicModel
        .updateOne({ telegramTopicId, groupId }, { isActive })
        .exec();

      this.logger.log(
        `[${new Date().toISOString()}] 📝 Updated topic ${telegramTopicId} active status: ${isActive}`,
      );
    } catch (error) {
      this.logger.error(
        `[${new Date().toISOString()}] ❌ Error updating topic status:`,
        error,
      );
    }
  }

  // เพิ่ม method สำหรับเพิ่ม topic ใหม่เข้า ticket ที่มีอยู่
  async addTopicToExistingTicket(
    ticketId: string,
    topicData: {
      telegramTopicId: number;
      name: string;
      groupId: string;
      createdBy?: string;
    },
  ): Promise<Topic> {
    const topic = await this.createTopic({
      ...topicData,
      ticketId,
      isPrimary: false,
    });

    return topic;
  }

  // อัปเดตสถิติข้อความของ topic
  async incrementMessageCount(
    telegramTopicId: number,
    groupId: string,
  ): Promise<void> {
    const topic = await this.topicModel
      .findOneAndUpdate(
        { telegramTopicId, groupId },
        {
          $inc: { messageCount: 1 },
          lastMessageAt: new Date(),
        },
      )
      .exec();

    // อัปเดตสถิติใน ticket ด้วย
    if (topic && topic.ticketId) {
      await this.ticketService.incrementMessageCount(topic.ticketId);
    }
  }
}
