import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Message, MessageDocument, MessageType } from './schemas/message.schema';

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
  ) {}

  async saveMessage(messageData: Partial<Message>): Promise<Message> {
    const message = new this.messageModel(messageData);
    return message.save();
  }

  async findByTelegramMessageId(
    telegramMessageId: number,
    groupId: string,
    topicId: number
  ): Promise<Message | null> {
    return this.messageModel
      .findOne({ telegramMessageId, groupId, topicId })
      .exec();
  }

  async findByTopicId(topicId: number, groupId: string, limit: number = 50): Promise<Message[]> {
    return this.messageModel
      .find({ topicId, groupId, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async findByTicketId(ticketId: string, limit: number = 50): Promise<Message[]> {
    return this.messageModel
      .find({ ticketId, isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async findRepliesTo(messageId: number, groupId: string, topicId: number): Promise<Message[]> {
    return this.messageModel
      .find({
        replyToMessageId: messageId,
        groupId,
        topicId,
        isDeleted: false
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  async markAsSynced(messageId: string, topicId: number): Promise<void> {
    await this.messageModel
      .updateOne(
        { _id: messageId },
        {
          $set: { isSynced: true },
          $addToSet: { syncedToTopics: topicId }
        }
      )
      .exec();
  }

  async markAsEdited(
    telegramMessageId: number,
    groupId: string,
    topicId: number,
    newText: string
  ): Promise<void> {
    await this.messageModel
      .updateOne(
        { telegramMessageId, groupId, topicId },
        {
          text: newText,
          isEdited: true,
          editDate: new Date()
        }
      )
      .exec();
  }

  async markAsDeleted(
    telegramMessageId: number,
    groupId: string,
    topicId: number
  ): Promise<void> {
    await this.messageModel
      .updateOne(
        { telegramMessageId, groupId, topicId },
        { isDeleted: true }
      )
      .exec();
  }

  async getMessageStats(topicId?: number, ticketId?: string): Promise<{
    totalMessages: number;
    messagesByType: Record<MessageType, number>;
    messagesWithAttachments: number;
    repliesCount: number;
    forwardsCount: number;
  }> {
    const filter: any = { isDeleted: false };
    if (topicId) filter.topicId = topicId;
    if (ticketId) filter.ticketId = ticketId;

    const stats = await this.messageModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          messagesWithAttachments: {
            $sum: { $cond: ['$hasAttachments', 1, 0] }
          },
          repliesCount: {
            $sum: { $cond: [{ $ne: ['$replyToMessageId', null] }, 1, 0] }
          },
          forwardsCount: {
            $sum: { $cond: [{ $ne: ['$forwardFromMessageId', null] }, 1, 0] }
          }
        }
      }
    ]);

    const messagesByType = await this.messageModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$messageType',
          count: { $sum: 1 }
        }
      }
    ]);

    const typeMap = messagesByType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {} as Record<MessageType, number>);

    return {
      totalMessages: stats[0]?.totalMessages || 0,
      messagesByType: typeMap,
      messagesWithAttachments: stats[0]?.messagesWithAttachments || 0,
      repliesCount: stats[0]?.repliesCount || 0,
      forwardsCount: stats[0]?.forwardsCount || 0
    };
  }

  async findSyncableMessages(fromTopicId: number, toTopicId: number, groupId: string): Promise<Message[]> {
    return this.messageModel
      .find({
        topicId: fromTopicId,
        groupId,
        syncedToTopics: { $ne: toTopicId },
        isDeleted: false,
        isSystemMessage: false
      })
      .sort({ createdAt: 1 })
      .exec();
  }

  async updateAttachments(messageId: string, attachmentIds: string[]): Promise<void> {
    await this.messageModel
      .updateOne(
        { _id: messageId },
        {
          attachmentIds,
          hasAttachments: attachmentIds.length > 0
        }
      )
      .exec();
  }

  determineMessageType(telegramMessage: any): MessageType {
    if (telegramMessage.photo) return MessageType.PHOTO;
    if (telegramMessage.document) return MessageType.DOCUMENT;
    if (telegramMessage.video) return MessageType.VIDEO;
    if (telegramMessage.audio) return MessageType.AUDIO;
    if (telegramMessage.sticker) return MessageType.STICKER;
    if (telegramMessage.animation) return MessageType.ANIMATION;
    if (telegramMessage.voice) return MessageType.VOICE;
    if (telegramMessage.video_note) return MessageType.VIDEO_NOTE;
    if (telegramMessage.forward_from || telegramMessage.forward_from_chat) return MessageType.FORWARD;
    if (telegramMessage.reply_to_message) return MessageType.REPLY;

    return MessageType.TEXT; // Default
  }

  extractReplyInfo(telegramMessage: any): {
    replyToMessageId?: number;
    replyToText?: string;
    replyToSender?: string;
  } {
    const replyTo = telegramMessage.reply_to_message;
    if (!replyTo) return {};

    return {
      replyToMessageId: replyTo.message_id,
      replyToText: replyTo.text || replyTo.caption || '[Media]',
      replyToSender: replyTo.from?.first_name || replyTo.from?.username || 'Unknown'
    };
  }

  extractForwardInfo(telegramMessage: any): {
    forwardFromChatId?: string;
    forwardFromMessageId?: number;
    forwardFromSender?: string;
    forwardDate?: Date;
  } {
    if (!telegramMessage.forward_from && !telegramMessage.forward_from_chat) {
      return {};
    }

    return {
      forwardFromChatId: telegramMessage.forward_from_chat?.id?.toString(),
      forwardFromMessageId: telegramMessage.forward_from_message_id,
      forwardFromSender: telegramMessage.forward_from?.first_name ||
                         telegramMessage.forward_from?.username ||
                         telegramMessage.forward_from_chat?.title ||
                         'Unknown',
      forwardDate: telegramMessage.forward_date ? new Date(telegramMessage.forward_date * 1000) : undefined
    };
  }
}