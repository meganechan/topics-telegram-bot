import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Group, GroupDocument } from "./schemas/group.schema";

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private groupModel: Model<GroupDocument>,
  ) {}

  async createGroup(groupData: Partial<Group>): Promise<Group> {
    const group = new this.groupModel(groupData);
    return group.save();
  }

  async findByTelegramGroupId(telegramGroupId: string): Promise<Group | null> {
    return this.groupModel.findOne({ telegramGroupId }).exec();
  }

  async findOrCreateGroup(groupData: Partial<Group>): Promise<Group> {
    let group = await this.findByTelegramGroupId(groupData.telegramGroupId);
    if (!group) {
      group = await this.createGroup(groupData);
    }
    return group;
  }

  async updateGroup(
    telegramGroupId: string,
    updateData: Partial<Group>,
  ): Promise<Group> {
    return this.groupModel
      .findOneAndUpdate({ telegramGroupId }, updateData, { new: true })
      .exec();
  }

  async updateBotStatus(
    telegramGroupId: string,
    botIsAdmin: boolean,
    supportTopicsEnabled: boolean,
  ): Promise<Group> {
    return this.updateGroup(telegramGroupId, {
      botIsAdmin,
      supportTopicsEnabled,
    });
  }

  async findAll(): Promise<Group[]> {
    return this.groupModel.find().exec();
  }
}
