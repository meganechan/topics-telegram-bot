import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { HooksService } from "./hooks.service";
import { ApiKeyGuard } from "../api/guards/api-key.guard";
import { RequireScope } from "../../common/decorators/api-scope.decorator";
import { ApiKeyScope } from "../api/schemas/api-key.schema";
import { CreateHookDto } from "./dto/create-hook.dto";
import { UpdateHookDto } from "./dto/update-hook.dto";
import { HookEvent } from "./schemas/hook.schema";

@Controller("api/v1/hooks")
@UseGuards(ApiKeyGuard)
export class HooksController {
  constructor(private readonly hooksService: HooksService) {}

  @Post()
  @RequireScope(ApiKeyScope.ADMIN)
  async createHook(@Body() createHookDto: CreateHookDto) {
    const hook = await this.hooksService.createHook(createHookDto);

    return {
      success: true,
      data: hook,
    };
  }

  @Get()
  @RequireScope(ApiKeyScope.READ)
  async listHooks() {
    const hooks = await this.hooksService.findAll();

    return {
      success: true,
      data: hooks,
    };
  }

  @Get("events")
  @RequireScope(ApiKeyScope.READ)
  async listEvents() {
    return {
      success: true,
      data: Object.values(HookEvent),
    };
  }

  @Get("logs")
  @RequireScope(ApiKeyScope.READ)
  async getRecentLogs(@Query("limit") limit: number = 100) {
    const logs = await this.hooksService.getRecentLogs(Math.min(limit, 500));

    return {
      success: true,
      data: logs,
    };
  }

  @Get(":id")
  @RequireScope(ApiKeyScope.READ)
  async getHook(@Param("id") id: string) {
    const hook = await this.hooksService.findById(id);
    if (!hook) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      data: hook,
    };
  }

  @Put(":id")
  @RequireScope(ApiKeyScope.ADMIN)
  async updateHook(
    @Param("id") id: string,
    @Body() updateHookDto: UpdateHookDto,
  ) {
    const hook = await this.hooksService.updateHook(id, updateHookDto);
    if (!hook) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      data: hook,
    };
  }

  @Delete(":id")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteHook(@Param("id") id: string) {
    const deleted = await this.hooksService.deleteHook(id);
    if (!deleted) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      message: "Hook deleted successfully",
    };
  }

  @Post(":id/activate")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async activateHook(@Param("id") id: string) {
    const hook = await this.hooksService.activateHook(id);
    if (!hook) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      data: hook,
    };
  }

  @Post(":id/deactivate")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deactivateHook(@Param("id") id: string) {
    const hook = await this.hooksService.deactivateHook(id);
    if (!hook) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      data: hook,
    };
  }

  @Post(":id/test")
  @RequireScope(ApiKeyScope.ADMIN)
  @HttpCode(HttpStatus.OK)
  async testHook(@Param("id") id: string) {
    const result = await this.hooksService.testHook(id);

    return {
      success: result.success,
      data: result,
    };
  }

  @Get(":id/logs")
  @RequireScope(ApiKeyScope.READ)
  async getHookLogs(
    @Param("id") id: string,
    @Query("limit") limit: number = 50,
  ) {
    const hook = await this.hooksService.findById(id);
    if (!hook) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    const logs = await this.hooksService.getHookLogs(id, Math.min(limit, 200));

    return {
      success: true,
      data: logs,
    };
  }

  @Get(":id/stats")
  @RequireScope(ApiKeyScope.READ)
  async getHookStats(@Param("id") id: string) {
    const stats = await this.hooksService.getHookStats(id);
    if (!stats) {
      throw new NotFoundException(`Hook ${id} not found`);
    }

    return {
      success: true,
      data: stats,
    };
  }
}
