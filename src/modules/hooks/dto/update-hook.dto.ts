import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsNumber,
  IsUrl,
  Min,
  Max,
  MaxLength,
} from "class-validator";
import { HookEvent, HookStatus } from "../schemas/hook.schema";

export class UpdateHookDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUrl()
  url?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(HookEvent, { each: true })
  events?: HookEvent[];

  @IsOptional()
  @IsEnum(HookStatus)
  status?: HookStatus;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  headers?: Record<string, string>;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(60000)
  timeout?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filterTicketStatuses?: string[];
}
