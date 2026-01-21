import { IsString, IsOptional, MaxLength, IsNumber } from "class-validator";

export class SendMessageDto {
  @IsString()
  @MaxLength(4096)
  text: string;

  @IsOptional()
  @IsNumber()
  replyToMessageId?: number;
}
