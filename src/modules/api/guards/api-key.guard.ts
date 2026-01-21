import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiKeyService } from "../api-key.service";
import { ApiKeyScope } from "../schemas/api-key.schema";

export const API_KEY_SCOPE = "apiKeyScope";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException("API key is required");
    }

    const requiredScope = this.reflector.get<ApiKeyScope>(
      API_KEY_SCOPE,
      context.getHandler(),
    );

    try {
      const validatedKey = await this.apiKeyService.validateApiKey(
        apiKey,
        requiredScope,
      );

      // Check IP whitelist if configured
      if (validatedKey.allowedIps && validatedKey.allowedIps.length > 0) {
        const clientIp = request.ip || request.connection.remoteAddress;
        if (!validatedKey.allowedIps.includes(clientIp)) {
          throw new UnauthorizedException("IP address not allowed");
        }
      }

      request.apiKey = validatedKey;
      return true;
    } catch (error) {
      throw new UnauthorizedException(error.message);
    }
  }

  private extractApiKey(request: any): string | null {
    // Check Authorization header (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Check X-API-Key header
    const xApiKey = request.headers["x-api-key"];
    if (xApiKey) {
      return xApiKey;
    }

    // Check query parameter
    if (request.query.api_key) {
      return request.query.api_key;
    }

    return null;
  }
}
