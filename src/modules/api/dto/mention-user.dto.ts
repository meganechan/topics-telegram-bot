import { IsString, IsOptional, MaxLength } from "class-validator";

export class MentionUserDto {
  @IsString()
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
