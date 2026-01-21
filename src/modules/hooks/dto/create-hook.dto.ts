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
import { HookEvent } from "../schemas/hook.schema";

export class CreateHookDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsUrl()
  url: string;

  @IsArray()
  @IsEnum(HookEvent, { each: true })
  events: HookEvent[];

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
