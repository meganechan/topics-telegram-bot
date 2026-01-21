import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ApiKey, ApiKeyDocument, ApiKeyScope } from "./schemas/api-key.schema";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
  ) {}

  async createApiKey(data: {
    name: string;
    description?: string;
    scopes?: ApiKeyScope[];
    expiresAt?: Date;
    allowedIps?: string[];
    createdBy?: string;
  }): Promise<{ apiKey: ApiKey; rawKey: string }> {
    const rawKey = `tk_${uuidv4().replace(/-/g, "")}`;

    const apiKey = new this.apiKeyModel({
      key: rawKey,
      name: data.name,
      description: data.description,
      scopes: data.scopes || [ApiKeyScope.READ],
      expiresAt: data.expiresAt,
      allowedIps: data.allowedIps || [],
      createdBy: data.createdBy,
    });

    await apiKey.save();
    return { apiKey, rawKey };
  }

  async validateApiKey(
    key: string,
    requiredScope?: ApiKeyScope,
  ): Promise<ApiKey> {
    const apiKey = await this.apiKeyModel.findOne({ key, isActive: true });

    if (!apiKey) {
      throw new UnauthorizedException("Invalid API key");
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException("API key has expired");
    }

    if (
      requiredScope &&
      !apiKey.scopes.includes(requiredScope) &&
      !apiKey.scopes.includes(ApiKeyScope.ADMIN)
    ) {
      throw new UnauthorizedException(
        `API key does not have required scope: ${requiredScope}`,
      );
    }

    // Update usage stats
    await this.apiKeyModel.updateOne(
      { _id: apiKey._id },
      {
        lastUsedAt: new Date(),
        $inc: { usageCount: 1 },
      },
    );

    return apiKey;
  }

  async findAll(): Promise<ApiKey[]> {
    return this.apiKeyModel.find().select("-key").exec();
  }

  async findById(id: string): Promise<ApiKey | null> {
    return this.apiKeyModel.findById(id).select("-key").exec();
  }

  async deactivate(id: string): Promise<ApiKey | null> {
    return this.apiKeyModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.apiKeyModel.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  async updateScopes(
    id: string,
    scopes: ApiKeyScope[],
  ): Promise<ApiKey | null> {
    return this.apiKeyModel
      .findByIdAndUpdate(id, { scopes }, { new: true })
      .exec();
  }
}
