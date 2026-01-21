import { SetMetadata } from "@nestjs/common";
import { ApiKeyScope } from "../../modules/api/schemas/api-key.schema";

export const API_KEY_SCOPE = "apiKeyScope";
export const RequireScope = (scope: ApiKeyScope) =>
  SetMetadata(API_KEY_SCOPE, scope);
