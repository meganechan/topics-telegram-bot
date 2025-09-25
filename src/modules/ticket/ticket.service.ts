import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ticket, TicketDocument, TicketStatus } from './schemas/ticket.schema';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TicketService {
  constructor(
    @InjectModel(Ticket.name) private ticketModel: Model<TicketDocument>,
  ) {}

  async createTicket(ticketData: Partial<Ticket>): Promise<Ticket> {
    const ticketId = this.generateTicketId();
    const ticket = new this.ticketModel({
      ...ticketData,
      ticketId,
      status: TicketStatus.OPEN,
      totalTopics: 0,
      totalMessages: 0,
      lastActivityAt: new Date(),
    });
    return ticket.save();
  }

  async findByTicketId(ticketId: string): Promise<Ticket | null> {
    return this.ticketModel.findOne({ ticketId }).exec();
  }

  // เปลี่ยนจาก findByTopicId เป็นหาตาม topic ใน topics array
  async findByTopicId(topicId: number, groupId: string): Promise<Ticket | null> {
    return this.ticketModel.findOne({
      'topics.topicId': topicId,
      'topics.groupId': groupId
    }).exec();
  }

  async updateTicket(
    ticketId: string,
    updateData: Partial<Ticket>,
  ): Promise<Ticket> {
    return this.ticketModel
      .findOneAndUpdate({ ticketId }, updateData, { new: true })
      .exec();
  }

  async closeTicket(ticketId: string): Promise<Ticket> {
    return this.updateTicket(ticketId, {
      status: TicketStatus.CLOSED,
      closedAt: new Date(),
    });
  }

  // เปลี่ยนจาก linkTicketToTopic เป็น addTopicToTicket
  async addTopicToTicket(
    ticketId: string, 
    topicData: {
      topicId: number;
      groupId: string;
      name: string;
      isPrimary?: boolean;
    }
  ): Promise<Ticket> {
    const updateData: any = {
      $addToSet: { topics: topicData },
      $inc: { totalTopics: 1 },
      lastActivityAt: new Date()
    };

    return this.ticketModel
      .findOneAndUpdate({ ticketId }, updateData, { new: true })
      .exec();
  }

  // ลบ topic ออกจาก ticket
  async removeTopicFromTicket(
    ticketId: string,
    topicId: number,
    groupId: string
  ): Promise<Ticket> {
    return this.ticketModel
      .findOneAndUpdate(
        { ticketId },
        { 
          $pull: { topics: { topicId, groupId } },
          $inc: { totalTopics: -1 }
        },
        { new: true }
      )
      .exec();
  }

  // เพิ่ม participant ใน ticket
  async addParticipant(ticketId: string, userId: string): Promise<Ticket> {
    return this.ticketModel
      .findOneAndUpdate(
        { ticketId },
        { $addToSet: { participants: userId } },
        { new: true }
      )
      .exec();
  }

  // อัปเดตสถิติข้อความ
  async incrementMessageCount(ticketId: string): Promise<Ticket> {
    return this.ticketModel
      .findOneAndUpdate(
        { ticketId },
        { 
          $inc: { totalMessages: 1 },
          lastActivityAt: new Date()
        },
        { new: true }
      )
      .exec();
  }

  // หา topics ทั้งหมดของ ticket
  async getTicketTopics(ticketId: string): Promise<Array<{
    topicId: number;
    groupId: string;
    name: string;
    isPrimary: boolean;
  }>> {
    const ticket = await this.findByTicketId(ticketId);
    return ticket?.topics || [];
  }

  private generateTicketId(): string {
    const timestamp = Date.now().toString(36);
    const randomStr = uuidv4().substring(0, 8);
    return `TICK-${timestamp}-${randomStr}`.toUpperCase();
  }

  async findTicketsByGroup(groupId: string): Promise<Ticket[]> {
    return this.ticketModel.find({ groupId }).exec();
  }

  async findOpenTicketsByGroup(groupId: string): Promise<Ticket[]> {
    return this.ticketModel
      .find({ groupId, status: TicketStatus.OPEN })
      .exec();
  }

  // หา tickets ที่มี topics ใน group นี้
  async findTicketsWithTopicsInGroup(groupId: string): Promise<Ticket[]> {
    return this.ticketModel
      .find({ 'topics.groupId': groupId })
      .exec();
  }
}