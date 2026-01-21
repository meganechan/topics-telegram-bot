import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyGuard } from "./guards/api-key.guard";
import { RequireScope } from "../../common/decorators/api-scope.decorator";
import { ApiKeyScope } from "./schemas/api-key.schema";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

@Controller("api/v1/api-keys")
@UseGuards(ApiKeyGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @RequireScope(ApiKeyScope.ADMIN)
  async createApiKey(@Body() createApiKeyDto: CreateApiKeyDto) {
    const { apiKey, rawKey } = await this.apiKeyService.createApiKey({
      name: createApiKeyDto.name,
      description: createApiKeyDto.description,
      scopes: createApiKeyDto.scopes,
      expiresAt: createApiKeyDto.expiresAt
        ? new Date(createApiKeyDto.expiresAt)
        : undefined,
      allowedIps: createApiKeyDto.allowedIps,
    });

    return {
      success: true,
      data: {
        id: (apiKey as any)._id,
        name: apiKey.name,
        key: rawKey, // Only returned on creation
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        allowedIps: apiKey.allowedIps,
        createdAt: (apiKey as any).createdAt,
      },
      message:
        "API key created successfully. Please save the key securely as it will not be shown again.",
    };
  }

  @Get()
  @RequireScope(ApiKeyScope.ADMIN)
  async listApiKeys() {
    const apiKeys = await this.apiKeyService.findAll();

    return {
      success: true,
      data: apiKeys.map((key) => ({
        id: (key as any)._id,
        name: key.name,
        description: key.description,
        scopes: key.scopes,
        isActive: key.isActive,
        expiresAt: key.expiresAt,
        lastUsedAt: key.lastUsedAt,
        usageCount: key.usageCount,
        allowedIps: key.allowedIps,
        createdAt: (key as any).createdAt,
      })),
    };
  }

  @Get(":id")
  @RequireScope(ApiKeyScope.ADMIN)
  async getApiKey(@Param("id") id: string) {
    const apiKey = await this.apiKeyService.findById(id);
    if (!apiKey) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    return {
      success: true,
      data: {
        id: (apiKey as any)._id,
        name: apiKey.name,
        description: apiKey.description,
        scopes: apiKey.scopes,
        isActive: apiKey.isActive,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        usageCount: apiKey.usageCount,
        allowedIps: apiKey.allowedIps,
        createdAt: (apiKey as any).createdAt,
      },
    };
  }

  @Delete(":id")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteApiKey(@Param("id") id: string) {
    const deleted = await this.apiKeyService.delete(id);
    if (!deleted) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    return {
      success: true,
      message: "API key deleted successfully",
    };
  }

  @Post(":id/deactivate")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deactivateApiKey(@Param("id") id: string) {
    const apiKey = await this.apiKeyService.deactivate(id);
    if (!apiKey) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    return {
      success: true,
      message: "API key deactivated successfully",
    };
  }
}
