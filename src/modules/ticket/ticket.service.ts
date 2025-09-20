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
    });
    return ticket.save();
  }

  async findByTicketId(ticketId: string): Promise<Ticket | null> {
    return this.ticketModel.findOne({ ticketId }).exec();
  }

  async findByTopicId(topicId: number): Promise<Ticket | null> {
    return this.ticketModel.findOne({ topicId }).exec();
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

  async linkTicketToTopic(ticketId: string, topicId: number): Promise<Ticket> {
    return this.updateTicket(ticketId, { topicId });
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
}