import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async createUser(userData: Partial<User>): Promise<User> {
    const user = new this.userModel(userData);
    return user.save();
  }

  async findByTelegramId(telegramId: string): Promise<User | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }

  async findOrCreateUser(userData: Partial<User>): Promise<User> {
    let user = await this.findByTelegramId(userData.telegramId);
    if (!user) {
      user = await this.createUser(userData);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userModel.findOne({
      $or: [
        { username },
        { externalUsername: username }
      ],
      isBot: false // Only find real users, not bots
    }).exec();
  }

  async searchUsersByUsername(searchTerm: string, limit: number = 10): Promise<User[]> {
    const regex = new RegExp(searchTerm, 'i'); // Case insensitive search
    return this.userModel
      .find({
        $or: [
          { username: regex },
          { externalUsername: regex },
          { firstName: regex },
          { lastName: regex }
        ],
        isBot: false // Only find real users, not bots
      })
      .select('telegramId username externalUsername firstName lastName')
      .limit(limit)
      .exec();
  }

  async validateInternalUser(username: string): Promise<boolean> {
    const user = await this.findByUsername(username);
    return user !== null && !user.isBot;
  }

  async findAllActiveUsers(excludeTelegramIds: string[] = []): Promise<User[]> {
    const query: any = {
      isBot: false
    };

    if (excludeTelegramIds.length > 0) {
      query.telegramId = { $nin: excludeTelegramIds };
    }

    return this.userModel
      .find(query)
      .select('telegramId username firstName lastName')
      .limit(20)
      .exec();
  }

  async updateUser(telegramId: string, updateData: Partial<User>): Promise<User> {
    return this.userModel
      .findOneAndUpdate({ telegramId }, updateData, { new: true })
      .exec();
  }
}