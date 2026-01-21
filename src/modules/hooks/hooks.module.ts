import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HooksController } from "./hooks.controller";
import { HooksService } from "./hooks.service";
import { Hook, HookSchema } from "./schemas/hook.schema";
import { HookLog, HookLogSchema } from "./schemas/hook-log.schema";
import { ApiModule } from "../api/api.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hook.name, schema: HookSchema },
      { name: HookLog.name, schema: HookLogSchema },
    ]),
    forwardRef(() => ApiModule),
  ],
  controllers: [HooksController],
  providers: [HooksService],
  exports: [HooksService],
})
export class HooksModule {}
